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
   'errorText', 'autoToggle'].forEach((id) => { els[id] = $(id); });

  const CFG = () => globalThis.WDAIDT_CONFIG || {};
  const MSGS = () => globalThis.WDAIDT_MESSAGES || {};

  let lastCapture = null; // { prompt, response } for Retry
  let lastDiag = null; // diagnostics payload for the Copy diagnostics button

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

  function showError(msg) {
    els.errorCard.hidden = false;
    els.errorText.textContent = msg;
    els.retryBtn.hidden = false;
  }

  function clearResult() {
    els.resultCard.hidden = true;
    els.errorCard.hidden = true;
    els.modeBadge.hidden = true;
    if (els.diagBtn) els.diagBtn.hidden = true;
    lastDiag = null;
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
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
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
      throw err;
    }
    if (!prompt && response) {
      const err = new Error('Found an AI reply but no readable user message above it. Scroll to the latest exchange and press Why? again.');
      err.code = 'PROMPT_MISSING';
      err.stage = 'capture';
      err.details = meta;
      throw err;
    }
    return { prompt, response, meta };
  }

  async function postAnalyze(prompt, response) {
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
      request_id: (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()))
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

  // Clearly-labelled Day-1 fallback so manual Why? is demoable with no backend.
  function localPreviewAnalysis(prompt, response) {
    const topic = (prompt || '').split('\n')[0].slice(0, 120) || 'this question';
    return {
      _localPreview: true,
      why: `The response appears to answer "${topic}" directly from the wording of your prompt. (Local Day-1 preview — connect the backend for Gemini analysis.)`,
      influences: [
        'The wording and scope of your latest prompt appear to have shaped the answer most.',
        response.length > 800
          ? 'The long response appears to cover several sub-points, not a single fact.'
          : 'The short response appears to target the single point you asked about.'
      ],
      assumptions: [
        'Your latest message seems to contain the full context needed.'
      ],
      what_could_change: [
        'Adding your goal, constraints, or background could change the recommendation.'
      ]
    };
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
    els.whyText.textContent = data.why || '(empty)';
    renderList(els.influencesList, data.influences);
    renderList(els.assumptionsList, data.assumptions);
    renderList(els.changeList, data.what_could_change);
    if (data._localPreview) {
      els.modeBadge.hidden = false;
      els.modeBadge.textContent = 'Local preview — backend not connected';
    } else {
      els.modeBadge.hidden = true;
    }
    els.resultCard.hidden = false;
  }

  async function runWhy() {
    els.whyBtn.disabled = true;
    els.retryBtn.hidden = true;
    clearResult();
    try {
      setStatus('Capturing latest ChatGPT interaction…');
      const cap = await captureLatest();
      lastCapture = cap;
      els.captureCard.hidden = false;
      els.promptPreview.textContent = preview(cap.prompt);
      els.responsePreview.textContent = preview(cap.response);

      setStatus('Analyzing…');
      let data;
      try {
        data = await postAnalyze(cap.prompt, cap.response);
      } catch (backendErr) {
        if (backendErr) backendErr.stage = backendErr.stage || 'analysis';
        if (backendErr && backendErr.code === 'NETWORK') {
          data = localPreviewAnalysis(cap.prompt, cap.response);
        } else {
          throw backendErr;
        }
      }
      renderResult(data);
      setStatus('Done.');
    } catch (e) {
      showError((e && e.message) || 'Analysis failed. Please try again.');
      setStatus(e && e.stage === 'capture' ? 'Capture failed.' : 'Analysis failed.');
    } finally {
      els.whyBtn.disabled = false;
    }
  }

  async function checkBackend() {
    const cfg = CFG();
    const base = cfg.BACKEND_BASE_URL || 'http://localhost:8000';
    const url = globalThis.wdaidtHealthUrl ? globalThis.wdaidtHealthUrl(base) : base + '/health';
    try {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(url, { signal: controller.signal });
      clearTimeout(t);
      els.backendLine.textContent = res.ok
        ? `Backend: reachable at ${base}`
        : `Backend: reachable but unhealthy (${res.status})`;
    } catch {
      els.backendLine.textContent = `Backend: not reachable at ${base} — Day-1 local preview mode`;
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
      if (els.autoToggle.checked) {
        setStatus('Auto Analyze arrives on Day 3 (V0.3). Saved ON, but manual Why? is used in Day 1.');
      }
    });
  }

  els.whyBtn.addEventListener('click', runWhy);
  els.retryBtn.addEventListener('click', runWhy);
  if (els.diagBtn) els.diagBtn.addEventListener('click', copyDiagnostics);
  checkBackend();
  initAutoToggle();
})();
