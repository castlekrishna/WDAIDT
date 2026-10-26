/* WDAIDT side-panel controller (V2.1.0).
 * Coordinates in-extension analysis via Google Gemini API client or offline mock engine.
 * Content script captures ChatGPT dialogue only (zero network calls in content script).
 * Renders flexible LLM-generated documents with variable block combinations.
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const els = {};
  [
    'whyBtn', 'retryBtn', 'diagBtn', 'backendLine', 'statusLine', 'captureCard',
    'promptPreview', 'responsePreview', 'resultCard', 'modeBadge', 'errorCard',
    'errorText', 'autoToggle', 'statusDot', 'skeletonCard', 'copyAnalysisBtn',
    'captureAccordionToggle', 'captureAccordionContent', 'captureChevron', 'captureStatusBadge',
    'settingsToggleBtn', 'settingsCloseBtn', 'settingsCard',
    'responseStyleSelect', 'customInstructionsGroup', 'customInstructionsInput',
    'analysisDepthSelect', 'contextWindowSelect', 'captureContextBadge', 'documentTitle', 'documentContainer',
    'apiKeyInput', 'apiKeyToggleBtn', 'apiKeyClearBtn', 'apiKeyStatus', 'mockModeToggle'
  ].forEach((id) => { els[id] = $(id); });

  const CFG = () => globalThis.WDAIDT_CONFIG || {};
  const MSGS = () => globalThis.WDAIDT_MESSAGES || {};

  let lastCapture = null; // { prompt, response } for Retry
  let lastDiag = null; // diagnostics payload for the Copy diagnostics button
  let lastAnalysis = null; // parsed analysis result for Copy action

  // V0.6 In-memory settings state
  const settingsState = {
    responseStyle: 'Friendly and conversational',
    customInstructions: '',
    analysisDepth: 'Brief',
    contextWindow: 5,
    apiKey: '',
    mockMode: false
  };

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

  function formatCapturedForDisplay(text, maxChars) {
    const s = trimForBackend(text, maxChars);
    return s || '(empty)';
  }

  function parseValidContextWindow(val, supported, defaultVal) {
    const list = supported || (CFG().CONTEXT_WINDOWS || [0, 3, 5, 10]);
    const def = defaultVal != null ? defaultVal : (CFG().DEFAULT_CONTEXT_WINDOW != null ? CFG().DEFAULT_CONTEXT_WINDOW : 5);
    const parsed = parseInt(val, 10);
    if (Number.isInteger(parsed) && list.includes(parsed)) {
      return parsed;
    }
    return def;
  }

  function filterContextExchanges(history, maxExchanges, maxTotalChars) {
    if (!history || !Array.isArray(history) || maxExchanges <= 0) {
      return [];
    }
    const valid = [];
    for (const ex of history) {
      if (ex && typeof ex === 'object') {
        const p = typeof ex.prompt === 'string' ? ex.prompt.trim() : '';
        const r = typeof ex.response === 'string' ? ex.response.trim() : '';
        if (p && r) {
          valid.push({ prompt: p, response: r });
        }
      }
    }
    if (!valid.length) return [];

    // Select at most maxExchanges most recent eligible exchanges
    const candidates = valid.slice(-maxExchanges);

    // Enforce total context character size budget
    // Priority: retain complete most recent exchanges, drop older complete exchanges first
    if (typeof maxTotalChars === 'number' && maxTotalChars > 0) {
      const kept = [];
      let currentTotal = 0;
      for (let i = candidates.length - 1; i >= 0; i--) {
        const ex = candidates[i];
        const exLen = ex.prompt.length + ex.response.length;
        if (currentTotal + exLen <= maxTotalChars) {
          kept.unshift(ex);
          currentTotal += exLen;
        } else {
          // Budget reached; drop this older exchange and any preceding ones
          break;
        }
      }
      return kept;
    }

    return candidates;
  }

  function formatContextBadgeText(count) {
    if (!count || count <= 0) {
      return 'Current exchange only';
    }
    if (count === 1) {
      return 'Context: 1 previous exchange';
    }
    return `Context: ${count} previous exchanges`;
  }

  function setStatus(msg) {
    if (els.statusLine) els.statusLine.textContent = msg;
  }

  function setButtonLoading(loading) {
    if (!els.whyBtn) return;
    els.whyBtn.disabled = loading;
    const spinner = els.whyBtn.querySelector('.btn-spinner');
    const textSpan = els.whyBtn.querySelector('.btn-text');
    if (spinner) spinner.hidden = !loading;
    if (textSpan) textSpan.textContent = loading ? 'Analyzing…' : 'Why?';
  }

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
    if (els.errorCard) els.errorCard.hidden = false;
    if (els.errorText) els.errorText.textContent = msg;
    if (els.retryBtn) els.retryBtn.hidden = false;
  }

  function clearResult() {
    if (els.resultCard) {
      els.resultCard.classList.remove('loading');
      els.resultCard.hidden = true;
    }
    if (els.errorCard) els.errorCard.hidden = true;
    if (els.modeBadge) els.modeBadge.hidden = true;
    if (els.captureCard) els.captureCard.hidden = true;
    if (els.captureStatusBadge) els.captureStatusBadge.hidden = true;
    if (els.skeletonCard) els.skeletonCard.hidden = true;
    if (els.diagBtn) els.diagBtn.hidden = true;
    if (els.documentTitle) els.documentTitle.textContent = '';
    if (els.documentContainer) els.documentContainer.textContent = '';
    lastDiag = null;
    lastAnalysis = null;
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      return true;
    } catch {
      return false;
    }
  }

  async function copyDiagnostics() {
    if (!lastDiag) return;
    const text = JSON.stringify(lastDiag, null, 2);
    const ok = await copyToClipboard(text);
    if (ok) {
      setStatus('Diagnostics copied — paste it in the project chat.');
    } else {
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

  async function sendTabMessage(tabId, message) {
    try {
      const res = await chrome.tabs.sendMessage(tabId, message);
      return { sent: true, res };
    } catch (e) {
      return { sent: false, error: e };
    }
  }

  async function ensureContentScript(tabId) {
    try {
      if (chrome && chrome.scripting && chrome.scripting.executeScript) {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: [
            'src/shared/messages.js',
            'src/shared/db.js',
            'src/shared/context_builder.js',
            'src/shared/retention.js',
            'src/shared/summarizer.js',
            'src/content/conversation_capture.js',
            'src/content/chatgpt.js'
          ]
        });
        await new Promise((r) => setTimeout(r, 300));
        return true;
      }
    } catch {
      /* injection unavailable or blocked */
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
    const history = Array.isArray(res.history) ? res.history : [];
    return { prompt, response, meta, history, tabId: tab.id };
  }

  async function postAnalyze(prompt, response, requestId, context = []) {
    if (!settingsState.apiKey && !settingsState.mockMode && typeof chrome !== 'undefined' && chrome?.storage?.local?.get) {
      try {
        const stored = await chrome.storage.local.get(['wdaidt_gemini_api_key', 'wdaidt_mock_mode']);
        if (stored && stored.wdaidt_gemini_api_key) {
          settingsState.apiKey = String(stored.wdaidt_gemini_api_key).trim();
        }
        if (stored && typeof stored.wdaidt_mock_mode === 'boolean') {
          settingsState.mockMode = stored.wdaidt_mock_mode;
        }
        updateStatusIndicator();
      } catch { /* storage inaccessible */ }
    }
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
      context: Array.isArray(context) ? context : [],
      request_id: requestId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
      response_style: settingsState.responseStyle,
      custom_instructions: settingsState.responseStyle === 'Custom instructions'
        ? settingsState.customInstructions
        : null,
      analysis_depth: settingsState.analysisDepth,
      api_key: settingsState.apiKey
    };
    if (!body.prompt || !body.response) {
      const err = new Error('Missing prompt or response.');
      err.code = 'INVALID_REQUEST';
      throw err;
    }
    // 1. Mock Mode (Zero-setup local analysis without network call)
    if (settingsState.mockMode) {
      const mockObj = (globalThis.WDAIDT_MOCK && globalThis.WDAIDT_MOCK.generateMockAnalysis)
        || (typeof generateMockAnalysis !== 'undefined' ? generateMockAnalysis : null);
      if (mockObj) {
        return mockObj(body);
      }
    }

    // 2. Direct Gemini REST API Client
    const geminiObj = (globalThis.WDAIDT_GEMINI_CLIENT && globalThis.WDAIDT_GEMINI_CLIENT.callGemini)
      || (typeof wdaidtCallGemini !== 'undefined' ? wdaidtCallGemini : null);
    if (geminiObj) {
      try {
        return await geminiObj(body);
      } catch (err) {
        if (err && err.code === 'API_KEY_MISSING') {
          const keyErr = new Error('Gemini API key is not configured. Click the gear icon in the top right to add your key, or toggle Mock Mode.');
          keyErr.code = 'API_KEY_MISSING';
          throw keyErr;
        }
        if (err && err.code === 'PAYLOAD_TOO_LARGE') {
          const sizeErr = new Error('That conversation is too long for V1 limits (8k prompt / 20k response).');
          sizeErr.code = 'PAYLOAD_TOO_LARGE';
          throw sizeErr;
        }
        throw err;
      }
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

  // =========================================================================
  // V0.6 Dynamic Document Block Renderers (Safe DOM Creation)
  // =========================================================================

  function renderHeading(block) {
    const rawLevel = parseInt(block.level, 10);
    const level = (Number.isInteger(rawLevel) && rawLevel >= 1 && rawLevel <= 6) ? rawLevel : 2;
    const el = document.createElement(`h${level}`);
    el.className = `block-heading level-${level}`;
    el.textContent = String(block.content || '');
    return el;
  }

  function renderParagraph(block) {
    const el = document.createElement('p');
    el.className = 'block-paragraph';
    el.textContent = String(block.content || '');
    return el;
  }

  function renderList(block) {
    const isOrdered = block.style === 'ordered';
    const el = document.createElement(isOrdered ? 'ol' : 'ul');
    el.className = 'block-list';
    const items = Array.isArray(block.items) ? block.items : [];
    items.forEach((itemText) => {
      const li = document.createElement('li');
      li.textContent = String(itemText || '');
      el.appendChild(li);
    });
    if (!el.children.length) {
      const li = document.createElement('li');
      li.textContent = '(empty list)';
      li.className = 'muted';
      el.appendChild(li);
    }
    return el;
  }

  function renderCode(block) {
    const wrapper = document.createElement('div');
    wrapper.className = 'block-code-wrapper';

    const header = document.createElement('div');
    header.className = 'block-code-header';

    const lang = document.createElement('span');
    lang.className = 'block-code-lang';
    lang.textContent = String(block.language || 'code').trim();
    header.appendChild(lang);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'ghost block-code-copy';
    copyBtn.textContent = 'Copy';
    copyBtn.title = 'Copy code snippet';
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const codeText = String(block.content || '');
      const ok = await copyToClipboard(codeText);
      if (ok) {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
      }
    });
    header.appendChild(copyBtn);
    wrapper.appendChild(header);

    const pre = document.createElement('pre');
    pre.className = 'block-code';
    const code = document.createElement('code');
    code.textContent = String(block.content || '');
    pre.appendChild(code);
    wrapper.appendChild(pre);

    return wrapper;
  }

  function renderQuote(block) {
    const el = document.createElement('blockquote');
    el.className = 'block-quote';
    el.textContent = String(block.content || '');
    return el;
  }

  function renderTable(block) {
    const wrapper = document.createElement('div');
    wrapper.className = 'block-table-wrapper';

    const table = document.createElement('table');
    table.className = 'block-table';

    const headers = Array.isArray(block.headers) ? block.headers : [];
    if (headers.length > 0) {
      const thead = document.createElement('thead');
      const tr = document.createElement('tr');
      headers.forEach((h) => {
        const th = document.createElement('th');
        th.textContent = String(h || '');
        tr.appendChild(th);
      });
      thead.appendChild(tr);
      table.appendChild(thead);
    }

    const rows = Array.isArray(block.rows) ? block.rows : [];
    if (rows.length > 0) {
      const tbody = document.createElement('tbody');
      rows.forEach((row) => {
        const tr = document.createElement('tr');
        const cells = Array.isArray(row) ? row : [row];
        cells.forEach((cell) => {
          const td = document.createElement('td');
          td.textContent = String(cell || '');
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
    }

    wrapper.appendChild(table);
    return wrapper;
  }

  function renderCallout(block) {
    const wrapper = document.createElement('div');
    let variant = String(block.variant || 'info').toLowerCase();
    const validVariants = ['info', 'warning', 'caution', 'tip', 'note', 'important'];
    if (!validVariants.includes(variant)) variant = 'info';

    wrapper.className = `block-callout variant-${variant}`;

    const header = document.createElement('div');
    header.className = 'block-callout-header';

    const badge = document.createElement('span');
    badge.className = 'block-callout-badge';
    badge.textContent = variant.toUpperCase();
    header.appendChild(badge);

    if (block.title) {
      const title = document.createElement('span');
      title.className = 'block-callout-title';
      title.textContent = String(block.title);
      header.appendChild(title);
    }
    wrapper.appendChild(header);

    const content = document.createElement('div');
    content.className = 'block-callout-content';
    content.textContent = String(block.content || '');
    wrapper.appendChild(content);

    return wrapper;
  }

  function renderDivider() {
    const el = document.createElement('hr');
    el.className = 'block-divider';
    return el;
  }

  function renderNextPrompt(block) {
    const wrapper = document.createElement('div');
    wrapper.className = 'block-next-prompt';

    const header = document.createElement('div');
    header.className = 'block-next-prompt-header';

    const label = document.createElement('span');
    label.className = 'block-next-prompt-label';
    label.textContent = String(block.title || 'Suggested Next Prompt');
    header.appendChild(label);

    const copyBtn = document.createElement('button');
    copyBtn.className = 'ghost btn-mini block-next-prompt-copy';
    copyBtn.textContent = 'Copy prompt';
    copyBtn.title = 'Copy suggested follow-up prompt to clipboard';
    const promptText = String(block.prompt || block.content || '').trim();
    copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await copyToClipboard(promptText);
      if (ok) {
        copyBtn.textContent = 'Copied!';
        if (copyBtn.classList) copyBtn.classList.add('copied');
        setTimeout(() => {
          copyBtn.textContent = 'Copy prompt';
          if (copyBtn.classList) copyBtn.classList.remove('copied');
        }, 1500);
      }
    });
    header.appendChild(copyBtn);
    wrapper.appendChild(header);

    const body = document.createElement('div');
    body.className = 'block-next-prompt-text';
    body.textContent = promptText;
    wrapper.appendChild(body);

    return wrapper;
  }

  const BLOCK_RENDERERS = {
    heading: renderHeading,
    paragraph: renderParagraph,
    list: renderList,
    code: renderCode,
    quote: renderQuote,
    table: renderTable,
    callout: renderCallout,
    divider: renderDivider,
    next_prompt: renderNextPrompt
  };

  function renderBlock(block) {
    if (!block || typeof block !== 'object') return null;
    const renderer = BLOCK_RENDERERS[block.type];
    if (typeof renderer === 'function') {
      return renderer(block);
    }
    // Graceful handling for unknown block types: do not crash
    console.warn('[WDAIDT] Unknown or unsupported block type:', block.type);
    if (typeof block.content === 'string' && block.content.trim()) {
      return renderParagraph(block);
    }
    return null;
  }

  function renderResult(data) {
    lastAnalysis = data;
    if (els.resultCard) {
      els.resultCard.classList.remove('loading');
      els.resultCard.hidden = false;
    }

    const doc = (data && data.analysis) ? data.analysis : data;
    const title = (doc && doc.title) ? doc.title : 'Analysis';
    if (els.documentTitle) {
      els.documentTitle.textContent = title;
    }

    if (els.documentContainer) {
      els.documentContainer.textContent = '';
      const blocks = (doc && Array.isArray(doc.blocks)) ? doc.blocks : [];
      blocks.forEach((block) => {
        const domNode = renderBlock(block);
        if (domNode) {
          els.documentContainer.appendChild(domNode);
        }
      });
    }

    if (els.modeBadge) els.modeBadge.hidden = true;
    if (els.skeletonCard) els.skeletonCard.hidden = true;
    if (els.statusDot) els.statusDot.className = 'status-dot connected';
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

  async function analyzeCapture(cap, requestId, context = []) {
    setStatus('Analyzing…');
    if (els.statusDot) els.statusDot.className = 'status-dot analyzing';
    if (els.skeletonCard) els.skeletonCard.hidden = true;
    logEvent('analyze_start', {
      requestId,
      promptLen: (cap.prompt || '').length,
      responseLen: (cap.response || '').length,
      contextCount: (context || []).length
    });
    let data;
    try {
      data = await postAnalyze(cap.prompt, cap.response, requestId, context);
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
    if (els.resultCard) {
      els.resultCard.classList.add('loading');
      els.resultCard.hidden = false;
    }
    if (els.documentTitle) els.documentTitle.textContent = '';
    if (els.documentContainer) els.documentContainer.textContent = '';
    if (els.modeBadge) els.modeBadge.hidden = true;
    if (els.skeletonCard) els.skeletonCard.hidden = true;
  }

  async function resolveEnrichedContext(tabId, normPrompt, normResponse, fallbackHistory, maxEx, maxContextChars) {
    let filtered = filterContextExchanges(fallbackHistory, maxEx, maxContextChars);
    if (!tabId || maxEx <= 0) return filtered;
    try {
      const type = (MSGS().BUILD_CONTEXT) || 'WDAIDT_BUILD_CONTEXT';
      const attempt = await sendTabMessage(tabId, {
        type,
        payload: {
          maxExchanges: maxEx,
          maxTotalChars: maxContextChars,
          currentExchange: { prompt: normPrompt, response: normResponse },
          fallbackHistory
        }
      });
      if (attempt.sent && attempt.res && attempt.res.ok && attempt.res.contextResult) {
        const exchanges = attempt.res.contextResult.exchanges;
        if (Array.isArray(exchanges) && exchanges.length > 0) {
          return exchanges;
        }
      }
    } catch {
      /* non-fatal fallback */
    }
    return filtered;
  }

  async function runWhy() {
    setButtonLoading(true);
    if (els.retryBtn) els.retryBtn.hidden = true;
    clearResult();
    showLoadingAnalysis();
    try {
      setStatus('Capturing latest ChatGPT interaction…');
      const cap = await captureLatest();
      const cfg = CFG();
      const maxP = cfg.MAX_PROMPT_CHARS || 8000;
      const maxR = cfg.MAX_RESPONSE_CHARS || 20000;
      const normPrompt = trimForBackend(cap.prompt, maxP);
      const normResponse = trimForBackend(cap.response, maxR);
      const maxEx = parseValidContextWindow(settingsState.contextWindow);
      const maxContextChars = cfg.MAX_CONTEXT_TOTAL_CHARS || 30000;
      const filteredContext = await resolveEnrichedContext(
        cap.tabId,
        normPrompt,
        normResponse,
        cap.history,
        maxEx,
        maxContextChars
      );
      const normalizedCap = {
        prompt: normPrompt,
        response: normResponse,
        meta: cap.meta,
        context: filteredContext
      };
      lastCapture = normalizedCap;

      if (els.captureCard) els.captureCard.hidden = false;
      if (els.captureStatusBadge) els.captureStatusBadge.hidden = false;
      if (els.captureContextBadge) {
        els.captureContextBadge.textContent = formatContextBadgeText(filteredContext.length);
      }
      if (els.promptPreview) els.promptPreview.textContent = normPrompt || '(empty)';
      if (els.responsePreview) els.responsePreview.textContent = normResponse || '(empty)';

      const requestId = newRequestId();
      latestRequestId = requestId;
      await analyzeCapture(normalizedCap, requestId, filteredContext);
    } catch (e) {
      if (e && e.stage === 'capture') {
        logEvent('capture_error', { code: (e && e.code) || 'UNKNOWN' });
      }
      if (e && e.partial) {
        const cfg = CFG();
        const maxP = cfg.MAX_PROMPT_CHARS || 8000;
        const maxR = cfg.MAX_RESPONSE_CHARS || 20000;
        if (els.captureCard) els.captureCard.hidden = false;
        if (els.captureStatusBadge) els.captureStatusBadge.hidden = false;
        if (els.promptPreview) {
          els.promptPreview.textContent = e.partial.prompt
            ? trimForBackend(e.partial.prompt, maxP)
            : '(not captured)';
        }
        if (els.responsePreview) {
          els.responsePreview.textContent = e.partial.response
            ? trimForBackend(e.partial.response, maxR)
            : '(not captured)';
        }
      }
      showError((e && e.message) || 'Analysis failed. Please try again.');
      setStatus(e && e.stage === 'capture' ? 'Capture failed.' : 'Analysis failed.');
    } finally {
      setButtonLoading(false);
    }
  }

  async function runRetry() {
    if (!lastCapture || !lastCapture.prompt || !lastCapture.response) {
      return runWhy();
    }
    setButtonLoading(true);
    if (els.retryBtn) els.retryBtn.hidden = true;
    if (els.errorCard) els.errorCard.hidden = true;
    showLoadingAnalysis();
    try {
      setStatus('Retrying analysis…');
      if (els.captureCard) els.captureCard.hidden = false;
      if (els.captureStatusBadge) els.captureStatusBadge.hidden = false;
      const ctx = lastCapture.context || [];
      if (els.captureContextBadge) {
        els.captureContextBadge.textContent = formatContextBadgeText(ctx.length);
      }
      if (els.promptPreview) els.promptPreview.textContent = lastCapture.prompt || '(empty)';
      if (els.responsePreview) els.responsePreview.textContent = lastCapture.response || '(empty)';

      const requestId = newRequestId();
      latestRequestId = requestId;
      await analyzeCapture(lastCapture, requestId, ctx);
    } catch (e) {
      showError((e && e.message) || 'Analysis failed. Please try again.');
      setStatus('Analysis failed.');
    } finally {
      setButtonLoading(false);
    }
  }


  function autoHash(prompt, response) {
    return `${(prompt || '').length}:${(response || '').length}:` +
      `${(prompt || '').slice(-120)}|${(response || '').slice(-120)}`;
  }

  async function runAuto(prompt, response, history = []) {
    if (!els.autoToggle || !els.autoToggle.checked) return;
    const h = autoHash(prompt, response);
    if (h === lastAutoHash) return;
    lastAutoHash = h;
    clearResult();
    showLoadingAnalysis();
    try {
      const cfg = CFG();
      const maxP = cfg.MAX_PROMPT_CHARS || 8000;
      const maxR = cfg.MAX_RESPONSE_CHARS || 20000;
      const normPrompt = trimForBackend(prompt, maxP);
      const normResponse = trimForBackend(response, maxR);
      if (!normPrompt || !normResponse) return;

      const maxEx = parseValidContextWindow(settingsState.contextWindow);
      const maxContextChars = cfg.MAX_CONTEXT_TOTAL_CHARS || 30000;
      const activeTab = await getActiveTab();
      const filteredContext = await resolveEnrichedContext(
        activeTab && activeTab.id,
        normPrompt,
        normResponse,
        history,
        maxEx,
        maxContextChars
      );
      const cap = { prompt: normPrompt, response: normResponse, context: filteredContext };
      lastCapture = cap;

      if (els.captureCard) els.captureCard.hidden = false;
      if (els.captureStatusBadge) els.captureStatusBadge.hidden = false;
      if (els.captureContextBadge) {
        els.captureContextBadge.textContent = formatContextBadgeText(filteredContext.length);
      }
      if (els.promptPreview) els.promptPreview.textContent = normPrompt;
      if (els.responsePreview) els.responsePreview.textContent = normResponse;

      const requestId = newRequestId();
      latestRequestId = requestId;
      await analyzeCapture(cap, requestId, filteredContext);
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
        runAuto(message.prompt, message.response, message.history || []);
      }, 500);
    } catch {
      /* timers unavailable */
    }
  }

  // =========================================================================
  // V0.6 Markdown Export for Copy Action
  // =========================================================================

  function exportDocumentToMarkdown(doc) {
    if (!doc) return '';
    const lines = [];
    if (doc.title) {
      lines.push(`# ${doc.title}\n`);
    }
    const blocks = Array.isArray(doc.blocks) ? doc.blocks : [];
    blocks.forEach((b) => {
      if (!b) return;
      switch (b.type) {
        case 'heading': {
          const lvl = Math.max(1, Math.min(6, parseInt(b.level, 10) || 2));
          lines.push(`${'#'.repeat(lvl)} ${b.content || ''}\n`);
          break;
        }
        case 'paragraph': {
          lines.push(`${b.content || ''}\n`);
          break;
        }
        case 'list': {
          const isOrdered = b.style === 'ordered';
          (b.items || []).forEach((item, idx) => {
            lines.push(isOrdered ? `${idx + 1}. ${item}` : `- ${item}`);
          });
          lines.push('');
          break;
        }
        case 'code': {
          const lang = b.language || '';
          lines.push(`\`\`\`${lang}\n${b.content || ''}\n\`\`\`\n`);
          break;
        }
        case 'quote': {
          const quoted = String(b.content || '')
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n');
          lines.push(`${quoted}\n`);
          break;
        }
        case 'table': {
          const headers = b.headers || [];
          const rows = b.rows || [];
          if (headers.length) {
            lines.push(`| ${headers.join(' | ')} |`);
            lines.push(`| ${headers.map(() => '---').join(' | ')} |`);
            rows.forEach((row) => {
              const cells = Array.isArray(row) ? row : [row];
              lines.push(`| ${cells.join(' | ')} |`);
            });
            lines.push('');
          }
          break;
        }
        case 'callout': {
          const variant = (b.variant || 'NOTE').toUpperCase();
          const title = b.title ? ` ${b.title}` : '';
          lines.push(`> [!${variant}]${title}`);
          const calloutBody = String(b.content || '')
            .split('\n')
            .map((l) => `> ${l}`)
            .join('\n');
          lines.push(`${calloutBody}\n`);
          break;
        }
        case 'next_prompt': {
          const pText = b.prompt || b.content || '';
          const title = b.title || 'Suggested Next Prompt';
          lines.push(`### ${title}\n`);
          lines.push(`> ${pText.split('\n').join('\n> ')}\n`);
          break;
        }
        case 'divider': {
          lines.push('---\n');
          break;
        }
        default: {
          if (b.content) lines.push(`${b.content}\n`);
          break;
        }
      }
    });
    return lines.join('\n').trim();
  }

  async function copyAnalysis() {
    if (!lastAnalysis) return;
    const doc = lastAnalysis.analysis || lastAnalysis;
    const text = exportDocumentToMarkdown(doc);
    if (!text) return;

    const ok = await copyToClipboard(text);
    if (ok && els.copyAnalysisBtn) {
      const orig = els.copyAnalysisBtn.textContent;
      els.copyAnalysisBtn.textContent = 'Copied!';
      els.copyAnalysisBtn.classList.add('copied');
      setTimeout(() => {
        if (els.copyAnalysisBtn) {
          els.copyAnalysisBtn.textContent = orig;
          els.copyAnalysisBtn.classList.remove('copied');
        }
      }, 1800);
    } else if (!ok) {
      setStatus('Could not copy analysis.');
    }
  }

  let isCaptureExpanded = false;

  function setCaptureExpanded(expanded) {
    isCaptureExpanded = !!expanded;
    if (els.captureAccordionContent) {
      els.captureAccordionContent.hidden = !isCaptureExpanded;
    }
    if (els.captureChevron) {
      els.captureChevron.textContent = isCaptureExpanded ? '\u25B2' : '\u25BC';
    }
    if (els.captureAccordionToggle) {
      els.captureAccordionToggle.setAttribute('aria-expanded', String(isCaptureExpanded));
    }
  }

  function initAccordion() {
    if (!els.captureAccordionToggle) return;
    setCaptureExpanded(false);
    els.captureAccordionToggle.addEventListener('click', () => {
      setCaptureExpanded(!isCaptureExpanded);
    });
    els.captureAccordionToggle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setCaptureExpanded(!isCaptureExpanded);
      }
    });
  }

  function updateStatusIndicator() {
    if (!els.backendLine || !els.statusDot) return;
    if (settingsState.mockMode) {
      els.backendLine.textContent = 'Mode: Mock (offline)';
      els.statusDot.className = 'status-dot connected';
    } else if (settingsState.apiKey && settingsState.apiKey.trim()) {
      els.backendLine.textContent = 'Gemini: Ready';
      els.statusDot.className = 'status-dot connected';
    } else {
      els.backendLine.textContent = 'Gemini: API Key required';
      els.statusDot.className = 'status-dot warning';
    }
  }

  async function checkBackend() {
    updateStatusIndicator();
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
            /* tab without content script */
          }
        }
      }
    } catch {
      /* tabs API unavailable */
    }
  }

  async function initAutoToggle() {
    if (!els.autoToggle) return;
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

  // =========================================================================
  // V0.6 Settings UI & Persistence
  // =========================================================================

  async function initSettings() {
    // 1. Load preferences from chrome.storage.local
    try {
      const stored = await chrome.storage.local.get([
        'wdaidt_response_style',
        'wdaidt_custom_instructions',
        'wdaidt_analysis_depth',
        'wdaidt_context_window',
        'wdaidt_gemini_api_key',
        'wdaidt_mock_mode'
      ]);
      if (stored.wdaidt_response_style) {
        settingsState.responseStyle = stored.wdaidt_response_style;
      }
      if (stored.wdaidt_custom_instructions != null) {
        settingsState.customInstructions = stored.wdaidt_custom_instructions;
      }
      if (stored.wdaidt_analysis_depth) {
        settingsState.analysisDepth = stored.wdaidt_analysis_depth;
      }
      if (stored.wdaidt_context_window != null) {
        settingsState.contextWindow = parseValidContextWindow(stored.wdaidt_context_window);
      } else {
        settingsState.contextWindow = 5;
      }
      if (stored && stored.wdaidt_gemini_api_key) {
        settingsState.apiKey = String(stored.wdaidt_gemini_api_key).trim();
      }
      if (stored && typeof stored.wdaidt_mock_mode === 'boolean') {
        settingsState.mockMode = stored.wdaidt_mock_mode;
      }
    } catch {
      /* fallback to defaults */
    }

    // Synchronize global status indicator with retrieved settings
    updateStatusIndicator();

    // 2. Synchronize UI controls
    if (els.responseStyleSelect) {
      els.responseStyleSelect.value = settingsState.responseStyle;
    }
    if (els.customInstructionsInput) {
      els.customInstructionsInput.value = settingsState.customInstructions;
    }
    if (els.customInstructionsGroup) {
      els.customInstructionsGroup.hidden = settingsState.responseStyle !== 'Custom instructions';
    }
    if (els.analysisDepthSelect) {
      els.analysisDepthSelect.value = settingsState.analysisDepth;
    }
    if (els.contextWindowSelect) {
      els.contextWindowSelect.value = String(settingsState.contextWindow);
    }

    function updateApiKeyStatusUI() {
      if (!els.apiKeyStatus) return;
      const hasKey = !!(settingsState.apiKey && settingsState.apiKey.trim());
      if (hasKey) {
        els.apiKeyStatus.textContent = 'Key saved locally';
        els.apiKeyStatus.className = 'api-key-status saved';
        if (els.apiKeyClearBtn) els.apiKeyClearBtn.hidden = false;
      } else {
        els.apiKeyStatus.textContent = 'Key not configured';
        els.apiKeyStatus.className = 'api-key-status muted';
        if (els.apiKeyClearBtn) els.apiKeyClearBtn.hidden = true;
      }
    }

    if (els.apiKeyInput) {
      els.apiKeyInput.value = settingsState.apiKey || '';
      updateApiKeyStatusUI();
    }
    if (els.mockModeToggle) {
      els.mockModeToggle.checked = !!settingsState.mockMode;
    }

    // 3. Attach event listeners
    if (els.settingsToggleBtn) {
      els.settingsToggleBtn.addEventListener('click', () => {
        if (!els.settingsCard) return;
        const willShow = els.settingsCard.hidden;
        els.settingsCard.hidden = !willShow;
        els.settingsToggleBtn.setAttribute('aria-expanded', String(willShow));
      });
    }

    if (els.settingsCloseBtn) {
      els.settingsCloseBtn.addEventListener('click', async () => {
        if (!els.settingsCard) return;
        if (els.apiKeyInput) {
          const key = els.apiKeyInput.value.trim();
          if (key !== settingsState.apiKey) {
            settingsState.apiKey = key;
            updateApiKeyStatusUI();
            updateStatusIndicator();
            try {
              if (key) {
                await chrome.storage.local.set({ wdaidt_gemini_api_key: key });
              } else {
                await chrome.storage.local.remove('wdaidt_gemini_api_key');
              }
            } catch { /* non-fatal */ }
          }
        }
        els.settingsCard.hidden = true;
        if (els.settingsToggleBtn) {
          els.settingsToggleBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    if (els.responseStyleSelect) {
      els.responseStyleSelect.addEventListener('change', async () => {
        const selected = els.responseStyleSelect.value;
        settingsState.responseStyle = selected;
        if (els.customInstructionsGroup) {
          els.customInstructionsGroup.hidden = selected !== 'Custom instructions';
        }
        try {
          await chrome.storage.local.set({ wdaidt_response_style: selected });
        } catch { /* non-fatal */ }
      });
    }

    if (els.customInstructionsInput) {
      els.customInstructionsInput.addEventListener('input', async () => {
        const val = els.customInstructionsInput.value;
        settingsState.customInstructions = val;
        try {
          await chrome.storage.local.set({ wdaidt_custom_instructions: val });
        } catch { /* non-fatal */ }
      });
    }

    if (els.analysisDepthSelect) {
      els.analysisDepthSelect.addEventListener('change', async () => {
        const selected = els.analysisDepthSelect.value;
        settingsState.analysisDepth = selected;
        try {
          await chrome.storage.local.set({ wdaidt_analysis_depth: selected });
        } catch { /* non-fatal */ }
      });
    }

    if (els.contextWindowSelect) {
      els.contextWindowSelect.addEventListener('change', async () => {
        const selected = parseValidContextWindow(els.contextWindowSelect.value);
        settingsState.contextWindow = selected;
        try {
          await chrome.storage.local.set({ wdaidt_context_window: selected });
        } catch { /* non-fatal */ }
      });
    }

    if (els.apiKeyInput) {
      const handleApiKeyInput = async () => {
        const key = els.apiKeyInput.value.trim();
        settingsState.apiKey = key;
        updateApiKeyStatusUI();
        updateStatusIndicator();
        try {
          if (key) {
            await chrome.storage.local.set({ wdaidt_gemini_api_key: key });
          } else {
            await chrome.storage.local.remove('wdaidt_gemini_api_key');
          }
        } catch { /* non-fatal */ }
      };

      els.apiKeyInput.addEventListener('input', handleApiKeyInput);
      els.apiKeyInput.addEventListener('change', handleApiKeyInput);
    }

    if (els.apiKeyToggleBtn && els.apiKeyInput) {
      els.apiKeyToggleBtn.addEventListener('click', () => {
        const isMasked = els.apiKeyInput.type === 'password';
        els.apiKeyInput.type = isMasked ? 'text' : 'password';
        els.apiKeyToggleBtn.textContent = isMasked ? 'Hide' : 'Show';
      });
    }

    if (els.apiKeyClearBtn && els.apiKeyInput) {
      els.apiKeyClearBtn.addEventListener('click', async () => {
        els.apiKeyInput.value = '';
        settingsState.apiKey = '';
        updateApiKeyStatusUI();
        updateStatusIndicator();
        try {
          await chrome.storage.local.remove('wdaidt_gemini_api_key');
        } catch { /* non-fatal */ }
      });
    }

    if (els.mockModeToggle) {
      els.mockModeToggle.addEventListener('change', async () => {
        const checked = !!els.mockModeToggle.checked;
        settingsState.mockMode = checked;
        updateStatusIndicator();
        try {
          await chrome.storage.local.set({ wdaidt_mock_mode: checked });
        } catch { /* non-fatal */ }
      });
    }


    if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && els.settingsCard && !els.settingsCard.hidden) {
          els.settingsCard.hidden = true;
          if (els.settingsToggleBtn) {
            els.settingsToggleBtn.setAttribute('aria-expanded', 'false');
            if (typeof els.settingsToggleBtn.focus === 'function') {
              els.settingsToggleBtn.focus();
            }
          }
        }
      });
    }

  }

  // Global listeners
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

  if (els.whyBtn) els.whyBtn.addEventListener('click', runWhy);
  if (els.retryBtn) els.retryBtn.addEventListener('click', runRetry);
  if (els.diagBtn) els.diagBtn.addEventListener('click', copyDiagnostics);
  if (els.copyAnalysisBtn) els.copyAnalysisBtn.addEventListener('click', copyAnalysis);

  initAccordion();
  initAutoToggle();
  initSettings();

  // Export for testing under Node.js test runner
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      renderBlock,
      renderHeading,
      renderParagraph,
      renderList,
      renderCode,
      renderQuote,
      renderTable,
      renderCallout,
      renderDivider,
      renderNextPrompt,
      BLOCK_RENDERERS,
      exportDocumentToMarkdown,
      settingsState,
      trimForBackend,
      formatCapturedForDisplay,
      parseValidContextWindow,
      filterContextExchanges,
      formatContextBadgeText,
      setCaptureExpanded,
      getCaptureExpanded: () => isCaptureExpanded,
      initAccordion,
      postAnalyze,
      analyzeCapture,
      newRequestId,
      isStale,
      getLatestRequestId: () => latestRequestId,
      setLatestRequestId: (id) => { latestRequestId = id; },
      showError,
      clearResult,
      renderResult,
      initAutoToggle,
      notifyTabsAuto,
      runRetry,
      getLastCapture: () => lastCapture,
      setLastCapture: (c) => { lastCapture = c; },
      updateStatusIndicator,
      initSettings
    };
  }
})();
