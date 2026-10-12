/* Day 1 (V0.1) side-panel controller.
 * Only this layer talks to the backend. Content script only captures.
 * If the backend is unreachable (expected on Day 1 before Krishna's mock
 * is live), we show a clearly-labelled local preview so the UI is testable.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {};
  ['whyBtn', 'retryBtn', 'backendLine', 'statusLine', 'captureCard',
   'promptPreview', 'responsePreview', 'resultCard', 'modeBadge', 'whyText',
   'influencesList', 'assumptionsList', 'changeList', 'errorCard',
   'errorText', 'autoToggle'].forEach((id) => { els[id] = $(id); });

  const CFG = () => globalThis.WDAIDT_CONFIG || {};
  const MSGS = () => globalThis.WDAIDT_MESSAGES || {};

  let lastCapture = null; // { prompt, response } for Retry

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
  }

  async function getActiveTab() {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs && tabs[0];
  }

  function isChatGPTUrl(url) {
    return !!url && (url.includes('chatgpt.com') || url.includes('chat.openai.com'));
  }

  async function captureLatest() {
    const tab = await getActiveTab();
    if (!tab || !tab.id) throw new Error('No active tab found.');
    if (!isChatGPTUrl(tab.url || '')) {
      throw new Error('Open a ChatGPT conversation (chatgpt.com) in the active tab, then click Why?');
    }
    const type = (MSGS().GET_LATEST) || 'WDAIDT_GET_LATEST';
    let res;
    try {
      res = await chrome.tabs.sendMessage(tab.id, { type });
    } catch {
      throw new Error('Could not reach the ChatGPT tab. Reload the ChatGPT page and try again.');
    }
    if (!res || res.ok === false) throw new Error('Capture failed on the ChatGPT page.');
    if (!res.prompt && !res.response) {
      throw new Error('No conversation found on this page yet. Ask ChatGPT something first.');
    }
    return { prompt: res.prompt || '', response: res.response || '' };
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
      setStatus('Failed.');
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
  checkBackend();
  initAutoToggle();
})();
