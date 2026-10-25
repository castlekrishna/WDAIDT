// V0.8 Extension-to-Backend Integration & UI State Tests
// Run with: node --test tests/extension/integration.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'sidepanel', 'app.js'), 'utf8');
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'config.js'), 'utf8');
const MESSAGES_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'messages.js'), 'utf8');

function mockEl(tag = 'div', id = '') {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  return {
    tagName: tag.toUpperCase(),
    id,
    checked: false,
    value: '',
    textContent: '',
    hidden: false,
    attributes,
    listeners,
    children: [],
    get className() { return Array.from(classes).join(' '); },
    set className(val) {
      classes.clear();
      (val || '').split(/\s+/).filter(Boolean).forEach((c) => classes.add(c));
    },
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
    },
    setAttribute(k, v) { attributes[k] = String(v); },
    getAttribute(k) { return attributes[k] != null ? attributes[k] : null; },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(evt, fn) {
      if (!listeners[evt]) listeners[evt] = [];
      listeners[evt].push(fn);
    },
    dispatchEvent(evt) {
      (listeners[evt] || []).forEach((fn) => fn({ target: this }));
    },
    querySelector: () => null,
  };
}

function createIntegrationSandbox(customFetch, initialStorage = {}) {
  const store = { ...initialStorage };
  const elements = {};
  const queryTabs = [];
  const sentTabMessages = [];

  const sandbox = {
    console: {
      debug: () => {},
      warn: () => {},
      error: () => {},
    },
    document: {
      createElement: (tag) => mockEl(tag),
      getElementById: (id) => {
        if (!elements[id]) elements[id] = mockEl('div', id);
        return elements[id];
      },
    },
    navigator: {
      clipboard: {
        async writeText() { return true; },
      },
    },
    fetch: customFetch || (async () => ({ ok: true, status: 200, json: async () => ({}) })),
    AbortController: class {
      constructor() {
        this.signal = { aborted: false };
      }
      abort() {
        this.signal.aborted = true;
      }
    },
    chrome: {
      storage: {
        local: {
          async get(keys) {
            const out = {};
            const arr = Array.isArray(keys) ? keys : [keys];
            arr.forEach((k) => { if (k in store) out[k] = store[k]; });
            return out;
          },
          async set(obj) {
            Object.assign(store, obj);
          },
        },
      },
      runtime: {
        onMessage: { addListener: () => {} },
      },
      tabs: {
        query: async (queryObj) => {
          queryTabs.push(queryObj);
          return [{ id: 101, url: 'https://chatgpt.com/c/test-chat' }];
        },
        sendMessage: async (tabId, msg) => {
          sentTabMessages.push({ tabId, msg });
          return { ok: true };
        },
      },
    },
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    clearTimeout: (id) => clearTimeout(id),
    crypto: {
      randomUUID: () => 'mock-uuid-1234',
    },
    module: { exports: {} },
  };

  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(MESSAGES_SRC, sandbox);
  vm.runInContext(CONFIG_SRC, sandbox);
  vm.runInContext(APP_SRC, sandbox);

  return {
    exports: sandbox.module.exports,
    elements,
    store,
    sentTabMessages,
    queryTabs,
    sandbox,
  };
}

// -----------------------------------------------------------------------------
// 1. Request Transmission & Configuration
// -----------------------------------------------------------------------------

test('postAnalyze transmits prompt, response, context, request_id, response_style, and depth accurately', async () => {
  let capturedUrl = '';
  let capturedBody = null;

  const mockFetch = async (url, opts) => {
    capturedUrl = url;
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        request_id: capturedBody.request_id,
        analysis: { title: 'Test Diagnosis', blocks: [] },
      }),
    };
  };

  const { exports } = createIntegrationSandbox(mockFetch);
  const context = [{ prompt: 'Earlier Q', response: 'Earlier A' }];
  const res = await exports.postAnalyze('Current Q', 'Current A', 'custom-req-id', context);

  assert.equal(capturedUrl, 'http://localhost:8000/analyze');
  assert.equal(capturedBody.prompt, 'Current Q');
  assert.equal(capturedBody.response, 'Current A');
  assert.equal(capturedBody.request_id, 'custom-req-id');
  assert.deepEqual(capturedBody.context, context);
  assert.equal(capturedBody.response_style, 'Professional and direct');
  assert.equal(capturedBody.custom_instructions, null);
  assert.equal(capturedBody.analysis_depth, 'Balanced');
  assert.equal(res.request_id, 'custom-req-id');
});

test('postAnalyze passes custom_instructions only when response_style is Custom instructions', async () => {
  let capturedBody = null;
  const mockFetch = async (_url, opts) => {
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ request_id: capturedBody.request_id, analysis: { title: 'T', blocks: [] } }),
    };
  };

  const { exports } = createIntegrationSandbox(mockFetch);
  exports.settingsState.responseStyle = 'Custom instructions';
  exports.settingsState.customInstructions = 'Explain as if to an aerospace engineer.';

  await exports.postAnalyze('How does thrust work?', 'Thrust is generated by...', 'req-custom');

  assert.equal(capturedBody.response_style, 'Custom instructions');
  assert.equal(capturedBody.custom_instructions, 'Explain as if to an aerospace engineer.');

  // Switch back to a preset style: custom_instructions must become null
  exports.settingsState.responseStyle = 'Casual and natural';
  await exports.postAnalyze('How does thrust work?', 'Thrust is generated by...', 'req-preset');
  assert.equal(capturedBody.response_style, 'Casual and natural');
  assert.equal(capturedBody.custom_instructions, null);
});

// -----------------------------------------------------------------------------
// 2. HTTP Status Code & Error Envelope Handling
// -----------------------------------------------------------------------------

test('postAnalyze handles 413 PAYLOAD_TOO_LARGE appropriately', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 413,
    json: async () => ({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeded' } }),
  });

  const { exports } = createIntegrationSandbox(mockFetch);
  await assert.rejects(
    async () => { await exports.postAnalyze('P', 'R', 'req-413'); },
    (err) => err.code === 'PAYLOAD_TOO_LARGE' && err.message.includes('too long for V1 limits')
  );
});

test('postAnalyze handles 429 RATE_LIMITED appropriately', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 429,
    json: async () => ({ error: { code: 'RATE_LIMITED', message: 'Rate limit exceeded' } }),
  });

  const { exports } = createIntegrationSandbox(mockFetch);
  await assert.rejects(
    async () => { await exports.postAnalyze('P', 'R', 'req-429'); },
    (err) => err.code === 'RATE_LIMITED' && err.message.includes('Too many requests')
  );
});

test('postAnalyze handles 422 INVALID_REQUEST with backend error message', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 422,
    json: async () => ({ error: { code: 'INVALID_REQUEST', message: 'Prompt and response must both be non-empty strings.' } }),
  });

  const { exports } = createIntegrationSandbox(mockFetch);
  await assert.rejects(
    async () => { await exports.postAnalyze('P', 'R', 'req-422'); },
    (err) => err.code === 'INVALID_REQUEST' && err.message === 'Prompt and response must both be non-empty strings.'
  );
});

test('postAnalyze handles 502 AI_PROVIDER_ERROR with backend error message', async () => {
  const mockFetch = async () => ({
    ok: false,
    status: 502,
    json: async () => ({ error: { code: 'AI_PROVIDER_ERROR', message: 'GEMINI_API_KEY is not configured.' } }),
  });

  const { exports } = createIntegrationSandbox(mockFetch);
  await assert.rejects(
    async () => { await exports.postAnalyze('P', 'R', 'req-502'); },
    (err) => err.code === 'AI_PROVIDER_ERROR' && err.message === 'GEMINI_API_KEY is not configured.'
  );
});

test('postAnalyze maps network failures (fetch rejected) to NETWORK code', async () => {
  const mockFetch = async () => {
    throw new TypeError('Failed to fetch (connection refused)');
  };

  const { exports } = createIntegrationSandbox(mockFetch);
  await assert.rejects(
    async () => { await exports.postAnalyze('P', 'R', 'req-net'); },
    (err) => err.code === 'NETWORK' && err.message.includes("Can't reach the analysis server")
  );
});

test('postAnalyze maps fetch timeout (AbortError) to TIMEOUT code', async () => {
  const mockFetch = async () => {
    const abortErr = new Error('The operation was aborted');
    abortErr.name = 'AbortError';
    throw abortErr;
  };

  const { exports } = createIntegrationSandbox(mockFetch);
  await assert.rejects(
    async () => { await exports.postAnalyze('P', 'R', 'req-timeout'); },
    (err) => err.code === 'TIMEOUT' && err.message.includes('took too long (>20s)')
  );
});

// -----------------------------------------------------------------------------
// 3. Stale Result Guard & Close-Succession Handling
// -----------------------------------------------------------------------------

test('stale result protection: older request responses are dropped when a newer request has been issued', async () => {
  const { exports, elements } = createIntegrationSandbox();

  // First request issued
  exports.setLatestRequestId('req-newer');

  // Stale data arriving with old id
  const staleData = {
    request_id: 'req-older',
    analysis: { title: 'Old Analysis', blocks: [] },
  };
  assert.equal(exports.isStale(staleData), true);

  // Fresh data arriving with matching latest id
  const freshData = {
    request_id: 'req-newer',
    analysis: { title: 'Fresh Analysis', blocks: [] },
  };
  assert.equal(exports.isStale(freshData), false);

  // Verify rendering happens for fresh data
  exports.renderResult(freshData);
  assert.equal(elements.documentTitle.textContent, 'Fresh Analysis');
  assert.equal(elements.resultCard.hidden, false);
});

// -----------------------------------------------------------------------------
// 4. UI Error & Retry States
// -----------------------------------------------------------------------------

test('showError updates UI cards and reveals retry button', () => {
  const { exports, elements } = createIntegrationSandbox();

  elements.resultCard.hidden = false;
  elements.skeletonCard.hidden = false;
  elements.retryBtn.hidden = true;
  elements.errorCard.hidden = true;

  exports.showError('Unable to connect to analysis server.');

  assert.equal(elements.skeletonCard.hidden, true);
  assert.equal(elements.resultCard.hidden, true);
  assert.equal(elements.errorCard.hidden, false);
  assert.equal(elements.errorText.textContent, 'Unable to connect to analysis server.');
  assert.equal(elements.retryBtn.hidden, false);
  assert.ok(elements.statusDot.classList.contains('error'));
});

// -----------------------------------------------------------------------------
// 5. Auto Toggle Persistence and Notification
// -----------------------------------------------------------------------------

test('auto toggle initialization loads stored state and change listener broadcasts message', async () => {
  const { exports, elements, store, sentTabMessages } = createIntegrationSandbox(null, {
    wdaidt_auto_analyze: true,
  });

  const autoToggleEl = elements.autoToggle;
  await exports.initAutoToggle();
  assert.equal(autoToggleEl.checked, true);

  // Toggle OFF
  autoToggleEl.checked = false;
  autoToggleEl.dispatchEvent('change');
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(store.wdaidt_auto_analyze, false);
  assert.ok(sentTabMessages.some((m) => m.msg.type === 'WDAIDT_AUTO_ANALYZE_OFF'));

  // Toggle ON
  autoToggleEl.checked = true;
  autoToggleEl.dispatchEvent('change');
  await new Promise((r) => setTimeout(r, 10));

  assert.equal(store.wdaidt_auto_analyze, true);
  assert.ok(sentTabMessages.some((m) => m.msg.type === 'WDAIDT_AUTO_ANALYZE_ON'));
});

test('runRetry uses lastCapture directly when available upon service recovery', async () => {
  let analyzedPayload = null;
  const customFetch = async (url, opts) => {
    analyzedPayload = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        request_id: analyzedPayload.request_id,
        analysis: {
          title: 'Recovered Analysis',
          blocks: [{ type: 'paragraph', content: 'Analysis after retry' }],
        },
      }),
    };
  };

  const { exports, elements } = createIntegrationSandbox(customFetch);
  exports.setLastCapture({
    prompt: 'How does quicksort work?',
    response: 'Quicksort is a divide-and-conquer algorithm.',
    context: [{ prompt: 'Sort algorithms overview', response: 'Here are common sort algorithms.' }],
  });

  await exports.runRetry();

  assert.ok(analyzedPayload, 'Fetch was executed');
  assert.equal(analyzedPayload.prompt, 'How does quicksort work?');
  assert.equal(analyzedPayload.response, 'Quicksort is a divide-and-conquer algorithm.');
  assert.equal(analyzedPayload.context.length, 1);
  assert.equal(elements.documentTitle.textContent, 'Recovered Analysis');
  assert.equal(elements.errorCard.hidden, true);
});
