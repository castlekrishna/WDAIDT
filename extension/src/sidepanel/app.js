/* WDAIDT side-panel controller (V0.2).
 * Only this layer talks to the backend. Content script only captures.
 * Capture errors and analysis errors are reported separately so the user
 * can tell whether ChatGPT text was found and whether the backend failed.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {};
  ['whyBtn', 'retryBtn', 'diagBtn', 'backendLine', 'statusLine', 'captureCard',
   'promptPreview', 'responsePreview', 'resultCard', 'modeBadge', 'whyText',
   'influencesList', 'assumptionsList', 'changeList', 'errorCard',
   'errorText', 'autoToggle', 'statusDot', 'skeletonCard', 'copyAnalysisBtn',
   'captureAccordionToggle', 'captureAccordionContent', 'captureChevron'].forEach((id) => { els[id] = $(id); });

  const CFG = () => globalThis.WDAIDT_CONFIG || {};
  const MSGS = () => globalThis.WDAIDT_MESSAGES || {};

  let lastCapture = null; // { prompt, response } for Retry
  let lastDiag = null; // diagnostics payload for the Copy diagnostics button
  let lastAnalysis = null; // parsed analysis result for Copy action

  function fpSummary(fp) {
    if (!fp) return 'n/a';
    const n = (v) => (v == null ? '?' : v);
    return `role=${n(fp.roleAttr)} mid=${n(fp.messageId)} turns=${n(fp.turnTestids)} ` +
      `articles=${n(fp.articles)} shadow=${n(fp.shadowRoots)} elems=${n(fp.elements)}`;
  }

  function trimForBackend(text, max) {
    const s = (text || '').trim();
    return s.length > max ? s.slice(0, max) : s;
  }

  function preview(text) {
    const limit = CFG().PREVIEW_CHARS || 600;
    const s = (text || '').trim();
    if (!s) return '(empty)';
    return s.length > limit ? s.slice(0, limit) + '…' : s;
  }

  function setStatus(msg) { els.statusLine.textContent = msg; }

  function setButtonLoading(loading) {
    if (!els.whyBtn) return;
    els.whyBtn.disabled = loading;
    const spinner = els.whyBtn.querySelector('.btn-spinner');
    const textSpan = els.whyBtn.querySelector('.btn-text');
    if (spinner) spinner.hidden = !loading;
    if (textSpan) textSpan.textContent = loading ? 'Analyzing…' : 'Why?';
  }

  // Structured diagnostics: stage outcomes + field lengths only. Never logs
  // prompt/response text, URLs, or anything identifying the conversation.
  function logEvent(event, info) {
    try {
      console.debug('[WDAIDT]', JSON.stringify({ event, ...(info || {}) }));
    } catch {
      /* logging must never break the flow */
    }
  }

  function showError(msg) {
    if (els.skeletonCard) els.skeletonCard.hidden = true;
    if (els.resultCard) els.resultCard.hidden = true;
    if (els.statusDot) els.statusDot.className = 'status-dot error';
    els.errorCard.hidden = false;
    els.errorText.textContent = msg;
    els.retryBtn.hidden = false;
  }

  function clearResult() {
    els.resultCard.classList.remove('loading');
    els.resultCard.hidden = true;
    els.errorCard.hidden = true;
    els.modeBadge.hidden = true;
    els.captureCard.hidden = true;
    if (els.skeletonCard) els.skeletonCard.hidden = true;
    if (els.diagBtn) els.diagBtn.hidden = true;
    lastDiag = null;
    lastAnalysis = null;
  }

  async function copyDiagnostics() {
    if (!lastDiag) return;
    const text = JSON.stringify(lastDiag, null, 2);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      setStatus('Diagnostics copied — paste it in the project chat.');
    } catch {
      setStatus('Could not copy. Select the error text manually.');
    }
  }

  async function getActiveTab() {
    let tabs;
    try {
      tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    } catch {
      tabs = null;
    }
    if (!tabs || !tabs.length) {
      try {
        tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      } catch {
        tabs = null;
      }
    }
    return tabs && tabs[0];
  }

  function isChatGPTUrl(url) {
    return !!url && (url.includes('chatgpt.com') || url.includes('chat.openai.com'));
  }

  async function sendGetLatest(tabId, type) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type });
      return { sent: true, res };
    } catch (e) {
      return { sent: false, error: e };
    }
  }

  // If the tab was open before the extension was (re)loaded, the static
  // content script may be missing. Inject it once, then retry.
  async function ensureContentScript(tabId) {
    try {
      if (chrome && chrome.scripting && chrome.scripting.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['src/shared/messages.js', 'src/content/chatgpt.js']
        });
        await new Promise((r) => setTimeout(r, 300));
        return true;
      }
    } catch {
      /* injection unavailable or blocked — fall through */
    }
    return false;
  }

  async function captureLatest() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) {
      const err = new Error('No active browser tab found. Click the ChatGPT tab, then press Why? again.');
      err.code = 'NO_ACTIVE_TAB';
      err.stage = 'capture';
      throw err;
    }
    if (!isChatGPTUrl(tab.url || '')) {
      const err = new Error('Open a ChatGPT conversation (chatgpt.com) in the active tab, then click Why?');
      err.code = 'NOT_CHATGPT_TAB';
      err.stage = 'capture';
      throw err;
    }
    const type = (MSGS().GET_LATEST) || 'WDAIDT_GET_LATEST';
    let attempt = await sendGetLatest(tab.id, type);
    if (!attempt.sent) {
      const injected = await ensureContentScript(tab.id);
      if (injected) attempt = await sendGetLatest(tab.id, type);
    }
    if (!attempt.sent) {
      const err = new Error('WDAIDT could not talk to the ChatGPT tab (content script missing). Reload the ChatGPT page, then press Why? again.');
      err.code = 'CONTENT_SCRIPT_MISSING';
      err.stage = 'capture';
      throw err;
    }
    const res = attempt.res;
    if (!res || res.ok === false) {
      const err = new Error('The ChatGPT page reported a capture failure. Reload the ChatGPT page and try again.');
      err.code = 'CAPTURE_FAILED';
      err.stage = 'capture';
      throw err;
    }
    const prompt = (res.prompt || '').trim();
    const response = (res.response || '').trim();
    const meta = {
      strategy: res.strategy || 'unknown',
      userCount: res.userCount || 0,
      assistantCount: res.assistantCount || 0,
      paired: !!res.paired
    };
    if (!prompt && !response) {
      const err = new Error(
        `No readable ChatGPT messages detected (strategy: ${meta.strategy}, ` +
        `users: ${meta.userCount}, assistants: ${meta.assistantCount}, ` +
        `page: ${fpSummary(res.fingerprint)}). ` +
        'Make sure a conversation with visible messages is open, wait for streaming to finish, then press Why?. ' +
        'If this repeats, press Copy diagnostics and share the output.'
      );
      err.code = 'CAPTURE_EMPTY';
      err.stage = 'capture';
      err.details = meta;
      lastDiag = {
        error: err.code,
        message: err.message,
        url: res.url || (tab && tab.url) || '',
        strategy: meta.strategy,
        userCount: meta.userCount,
        assistantCount: meta.assistantCount,
        fingerprint: res.fingerprint || null
      };
      if (els.diagBtn) els.diagBtn.hidden = false;
      throw err;
    }
    if (prompt && !response) {
      const err = new Error('Your latest message has no AI reply yet (or the reply is still streaming). Wait for ChatGPT to finish, then press Why?.');
      err.code = 'RESPONSE_PENDING';
      err.stage = 'capture';
      err.details = meta;
      err.partial = { prompt, response: '' };
      lastDiag = {
        error: err.code,
        message: err.message,
        url: res.url || (tab && tab.url) || '',
        strategy: meta.strategy,
        userCount: meta.userCount,
        assistantCount: meta.assistantCount,
        fingerprint: res.fingerprint || null
      };
      if (els.diagBtn) els.diagBtn.hidden = false;
      logEvent('capture_partial', { code: err.code, promptLen: prompt.length });
      throw err;
    }
    if (!prompt && response) {
      const err = new Error('Found an AI reply but no readable user message above it. Scroll to the latest exchange and press Why? again.');
      err.code = 'PROMPT_MISSING';
      err.stage = 'capture';
      err.details = meta;
      err.partial = { prompt: '', response };
      lastDiag = {
        error: err.code,
        message: err.message,
        url: res.url || (tab && tab.url) || '',
        strategy: meta.strategy,
        userCount: meta.userCount,
        assistantCount: meta.assistantCount,
        fingerprint: res.fingerprint || null
      };
      if (els.diagBtn) els.diagBtn.hidden = false;
      logEvent('capture_partial', { code: err.code, responseLen: response.length });
      throw err;
    }
    logEvent('capture_ok', {
      strategy: meta.strategy,
      userCount: meta.userCount,
      assistantCount: meta.assistantCount,
      paired: meta.paired,
      promptLen: prompt.length,
      responseLen: response.length
    });
    return { prompt, response, meta };
  }

  async function postAnalyze(prompt, response, requestId) {
    const cfg = CFG();
    const base = cfg.BACKEND_BASE_URL || 'http://localhost:8000';
    const url = (globalThis.wdaidtAnalyzeUrl
      ? globalThis.wdaidtAnalyzeUrl(base)
      : base + '/analyze');
    const maxP = cfg.MAX_PROMPT_CHARS || 8000;
    const maxR = cfg.MAX_RESPONSE_CHARS || 20000;
    const body = {
      prompt: trimForBackend(prompt, maxP),
      response: trimForBackend(response, maxR),
      request_id: requestId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
    };
    if (!body.prompt || !body.response) {
      const err = new Error('Missing prompt or response.');
      err.code = 'INVALID_REQUEST';
      throw err;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.FETCH_TIMEOUT_MS || 20000);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      if (res.status === 413) {
        const err = new Error('That conversation is too long for V1 limits (8k prompt / 20k response).');
        err.code = 'PAYLOAD_TOO_LARGE';
        throw err;
      }
      if (res.status === 429) {
        const err = new Error('Too many requests. Wait a moment and retry.');
        err.code = 'RATE_LIMITED';
        throw err;
      }
      if (!res.ok) {
        let code = 'INTERNAL';
        try {
          const data = await res.json();
          if (data?.error?.code) code = data.error.code;
          if (data?.error?.message) throw Object.assign(new Error(data.error.message), { code });
        } catch (e) {
          if (e.code) throw e;
        }
        const err = new Error('Analysis failed. Please try again.');
        err.code = code;
        throw err;
      }
      return await res.json();
    } catch (e) {
      if (e && e.code) throw e;
      if (e && e.name === 'AbortError') {
        const err = new Error("The analysis server took too long (>20s).");
        err.code = 'TIMEOUT';
        throw err;
      }
      const err = new Error("Can't reach the analysis server.");
      err.code = 'NETWORK';
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  function renderList(ul, items) {
    ul.textContent = '';
    (items || []).forEach((t) => {
      const li = document.createElement('li');
      li.textContent = t; // textContent: plain text only, per API agreement
      ul.appendChild(li);
    });
    if (!ul.children.length) {
      const li = document.createElement('li');
      li.textContent = '(none)';
      li.className = 'muted';
      ul.appendChild(li);
    }
  }

  function renderResult(data) {
    lastAnalysis = data;
    els.resultCard.classList.remove('loading');
    els.whyText.textContent = data.why || '(empty)';
    renderList(els.influencesList, data.influences);
    renderList(els.assumptionsList, data.assumptions);
    renderList(els.changeList, data.what_could_change);
    els.modeBadge.hidden = true;
    if (els.skeletonCard) els.skeletonCard.hidden = true;
    if (els.statusDot) els.statusDot.className = 'status-dot connected';
    els.resultCard.hidden = false;
  }

  let latestRequestId = null; // newest analysis request; older responses are dropped
  let autoTimer = null; // trailing debounce for auto triggers
  let lastAutoHash = ''; // dedupe key for the last auto-analyzed exchange

  function isStale(data) {
    try {
      if (typeof globalThis.wdaidtIsStaleResult === 'function') {
        return globalThis.wdaidtIsStaleResult(latestRequestId, data);
      }
    } catch {
      /* fall through */
    }
    return false;
  }

  function newRequestId() {
    try {
      if (crypto.randomUUID) return crypto.randomUUID();
    } catch {
      /* fall through */
    }
    return String(Date.now());
  }

  async function analyzeCapture(cap, requestId) {
    setStatus('Analyzing…');
    if (els.statusDot) els.statusDot.className = 'status-dot analyzing';
    if (els.skeletonCard) els.skeletonCard.hidden = true;
    logEvent('analyze_start', {
      requestId,
      promptLen: (cap.prompt || '').length,
      responseLen: (cap.response || '').length
    });
    let data;
    try {
      data = await postAnalyze(cap.prompt, cap.response, requestId);
    } catch (backendErr) {
      if (backendErr) backendErr.stage = backendErr.stage || 'analysis';
      logEvent('analyze_error', { code: (backendErr && backendErr.code) || 'UNKNOWN' });
      throw backendErr;
    }
    if (data && isStale(data)) {
      logEvent('analyze_stale_dropped', { requestId: data.request_id });
      setStatus('Skipped a stale result — a newer analysis is already running.');
      return;
    }
    logEvent('analyze_ok', { requestId: (data && data.request_id) || requestId });
    renderResult(data);
    setStatus('Done.');
  }

  function showLoadingAnalysis() {
    els.resultCard.classList.add('loading');
    els.resultCard.hidden = false;
    els.whyText.textContent = '';
    els.influencesList.textContent = '';
    els.assumptionsList.textContent = '';
    els.changeList.textContent = '';
    if (els.modeBadge) els.modeBadge.hidden = true;
    if (els.skeletonCard) els.skeletonCard.hidden = true;
  }

  async function runWhy() {
    setButtonLoading(true);
    els.retryBtn.hidden = true;
    clearResult();
    showLoadingAnalysis();
    try {
      setStatus('Capturing latest ChatGPT interaction…');
      const cap = await captureLatest();
      lastCapture = cap;
      els.captureCard.hidden = false;
      els.promptPreview.textContent = preview(cap.prompt);
      els.responsePreview.textContent = preview(cap.response);

      const requestId = newRequestId();
      latestRequestId = requestId;
      await analyzeCapture(cap, requestId);
    } catch (e) {
      if (e && e.stage === 'capture') {
        logEvent('capture_error', { code: (e && e.code) || 'UNKNOWN' });
      }
      if (e && e.partial) {
        // Partial capture: show what was found
        els.captureCard.hidden = false;
        els.promptPreview.textContent = e.partial.prompt
          ? preview(e.partial.prompt)
          : '(not captured)';
        els.responsePreview.textContent = e.partial.response
          ? preview(e.partial.response)
          : '(not captured)';
      }
      showError((e && e.message) || 'Analysis failed. Please try again.');
      setStatus(e && e.stage === 'capture' ? 'Capture failed.' : 'Analysis failed.');
    } finally {
      setButtonLoading(false);
    }
  }

  // Auto Analyze: content script reports a newly settled exchange. Debounce
  // rapid triggers, skip repeats of the same exchange, then analyze with the
  // same pipeline (and stale guard) as manual Why?.
  function autoHash(prompt, response) {
    return `${(prompt || '').length}:${(response || '').length}:` +
      `${(prompt || '').slice(-120)}|${(response || '').slice(-120)}`;
  }

  async function runAuto(prompt, response) {
    if (!els.autoToggle.checked) return;
    const h = autoHash(prompt, response);
    if (h === lastAutoHash) return;
    lastAutoHash = h;
    clearResult();
    showLoadingAnalysis();
    try {
      const cap = { prompt: (prompt || '').trim(), response: (response || '').trim() };
      if (!cap.prompt || !cap.response) return;
      lastCapture = cap;
      els.captureCard.hidden = false;
      els.promptPreview.textContent = preview(cap.prompt);
      els.responsePreview.textContent = preview(cap.response);
      const requestId = newRequestId();
      latestRequestId = requestId;
      await analyzeCapture(cap, requestId);
    } catch (e) {
      showError((e && e.message) || 'Analysis failed. Please try again.');
      setStatus(e && e.stage === 'capture' ? 'Capture failed.' : 'Analysis failed.');
    }
  }

  function onRuntimeMessage(message) {
    if (!message || typeof message.type !== 'string') return;
    const types = MSGS();
    if (message.type !== types.AUTO_ANALYZE_TRIGGER &&
        message.type !== 'WDAIDT_AUTO_ANALYZE_TRIGGER') return;
    try {
      if (autoTimer) clearTimeout(autoTimer);
    } catch {
      /* ignore */
    }
    try {
      autoTimer = setTimeout(() => {
        autoTimer = null;
        runAuto(message.prompt, message.response);
      }, 500);
    } catch {
      /* timers unavailable */
    }
  }

  async function copyAnalysis() {
    if (!lastAnalysis) return;
    const lines = [];
    if (lastAnalysis.why) {
      lines.push('### Why this answer?');
      lines.push(lastAnalysis.why);
      lines.push('');
    }
    if (lastAnalysis.influences && lastAnalysis.influences.length) {
      lines.push('### Influences');
      lastAnalysis.influences.forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    }
    if (lastAnalysis.assumptions && lastAnalysis.assumptions.length) {
      lines.push('### Assumptions');
      lastAnalysis.assumptions.forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    }
    if (lastAnalysis.what_could_change && lastAnalysis.what_could_change.length) {
      lines.push('### What could change it?');
      lastAnalysis.what_could_change.forEach((item) => lines.push(`- ${item}`));
      lines.push('');
    }
    const text = lines.join('\n').trim();
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      if (els.copyAnalysisBtn) {
        const orig = els.copyAnalysisBtn.textContent;
        els.copyAnalysisBtn.textContent = 'Copied!';
        els.copyAnalysisBtn.classList.add('copied');
        setTimeout(() => {
          if (els.copyAnalysisBtn) {
            els.copyAnalysisBtn.textContent = orig;
            els.copyAnalysisBtn.classList.remove('copied');
          }
        }, 1800);
      }
    } catch {
      setStatus('Could not copy analysis.');
    }
  }

  function initAccordion() {
    if (!els.captureAccordionToggle) return;
    els.captureAccordionToggle.addEventListener('click', () => {
      const content = els.captureAccordionContent;
      if (!content) return;
      const isHidden = content.hidden;
      content.hidden = !isHidden;
      if (els.captureChevron) {
        els.captureChevron.textContent = isHidden ? '\u25BC' : '\u25B2';
      }
    });
    els.captureAccordionToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        els.captureAccordionToggle.click();
      }
    });
  }

  async function checkBackend() {
    const cfg = CFG();
    const base = cfg.BACKEND_BASE_URL || 'http://localhost:8000';
    const url = globalThis.wdaidtHealthUrl ? globalThis.wdaidtHealthUrl(base) : base + '/health';
    try {
      if (els.statusDot) els.statusDot.className = 'status-dot checking';
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      if (res.ok) {
        els.backendLine.textContent = `Backend: reachable at ${base}`;
        if (els.statusDot) els.statusDot.className = 'status-dot connected';
      } else {
        els.backendLine.textContent = `Backend: reachable but unhealthy (${res.status})`;
        if (els.statusDot) els.statusDot.className = 'status-dot error';
      }
    } catch {
      els.backendLine.textContent = `Backend: not reachable at ${base} — start it to enable analysis`;
      if (els.statusDot) els.statusDot.className = 'status-dot error';
    }
  }

  async function notifyTabsAuto(on) {
    const types = MSGS();
    const type = on
      ? (types.AUTO_ANALYZE_ON || 'WDAIDT_AUTO_ANALYZE_ON')
      : (types.AUTO_ANALYZE_OFF || 'WDAIDT_AUTO_ANALYZE_OFF');
    try {
      const tabs = await chrome.tabs.query({ url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'] });
      for (const t of tabs || []) {
        if (t && t.id != null) {
          try {
            await chrome.tabs.sendMessage(t.id, { type });
          } catch {
            /* tab without content script — watcher reads storage on load */
          }
        }
      }
    } catch {
      /* tabs API unavailable — content scripts fall back to storage */
    }
  }

  async function initAutoToggle() {
    try {
      const stored = await chrome.storage.local.get('wdaidt_auto_analyze');
      els.autoToggle.checked = stored.wdaidt_auto_analyze === true;
    } catch { /* default OFF */ }
    els.autoToggle.addEventListener('change', async () => {
      try {
        await chrome.storage.local.set({ wdaidt_auto_analyze: els.autoToggle.checked });
      } catch { /* non-fatal */ }
      notifyTabsAuto(els.autoToggle.checked);
      setStatus(els.autoToggle.checked
        ? 'Auto Analyze ON — new ChatGPT replies will be analyzed automatically.'
        : 'Auto Analyze OFF — press Why? to analyze manually.');
    });
  }

  try {
    if (chrome.runtime && chrome.runtime.onMessage && chrome.runtime.onMessage.addListener) {
      chrome.runtime.onMessage.addListener((message) => {
        onRuntimeMessage(message);
        return undefined;
      });
    }
  } catch {
    /* non-fatal */
  }

  els.whyBtn.addEventListener('click', runWhy);
  els.retryBtn.addEventListener('click', runWhy);
  if (els.diagBtn) els.diagBtn.addEventListener('click', copyDiagnostics);
  if (els.copyAnalysisBtn) els.copyAnalysisBtn.addEventListener('click', copyAnalysis);
  initAccordion();
  checkBackend();
  initAutoToggle();
})();
