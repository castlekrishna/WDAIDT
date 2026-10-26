// V2.0 Full Integration & Extension-Only Pipeline Tests
// Run with: node --test tests/extension/integration_v2.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const MESSAGES_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'messages.js'), 'utf8');
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'config.js'), 'utf8');
const PROMPTS_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'prompts.js'), 'utf8');
const VALIDATOR_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'validator.js'), 'utf8');
const MOCK_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'mock-analyzer.js'), 'utf8');
const GEMINI_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'gemini-client.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'sidepanel', 'app.js'), 'utf8');

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

function createV2Sandbox(customFetch, initialStorage = {}) {
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
          async remove(key) {
            delete store[key];
          }
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
      randomUUID: () => 'mock-uuid-v2',
    },
    module: { exports: {} },
  };

  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(MESSAGES_SRC, sandbox);
  vm.runInContext(CONFIG_SRC, sandbox);
  vm.runInContext(PROMPTS_SRC, sandbox);
  vm.runInContext(VALIDATOR_SRC, sandbox);
  vm.runInContext(MOCK_SRC, sandbox);
  vm.runInContext(GEMINI_SRC, sandbox);
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

test('pipeline_v2: Mock Mode executes hermetically without network fetch or backend', async () => {
  let fetchCalled = false;
  const mockFetch = async () => {
    fetchCalled = true;
    throw new Error('Network fetch must NEVER occur in Mock Mode');
  };

  const { exports } = createV2Sandbox(mockFetch, { wdaidt_mock_mode: true });
  exports.settingsState.mockMode = true;

  const res = await exports.postAnalyze(
    'How do I implement caching in Redis?',
    'Use SET with an EX expiration time.',
    'req-mock-test'
  );

  assert.equal(fetchCalled, false, 'Fetch must not be called in Mock Mode');
  assert.equal(res.request_id, 'req-mock-test');
  assert.ok(res.analysis);
  assert.ok(res.analysis.title.includes('Interaction Diagnosis:'));
  assert.ok(res.analysis.blocks.length >= 1);
});

test('pipeline_v2: Live mode calls Google Gemini REST API directly with header auth', async () => {
  let capturedUrl = '';
  let capturedHeaders = null;
  let capturedBody = null;

  const dummyDoc = {
    title: 'Live Gemini Diagnosis',
    blocks: [
      { type: 'paragraph', content: 'The AI omitted edge case analysis.' },
      { type: 'next_prompt', prompt: 'Consider edge cases for null input.' }
    ]
  };

  const mockFetch = async (url, opts) => {
    capturedUrl = url;
    capturedHeaders = opts.headers;
    capturedBody = JSON.parse(opts.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [
          {
            content: { parts: [{ text: JSON.stringify(dummyDoc) }] },
            finishReason: 'STOP'
          }
        ]
      })
    };
  };

  const { exports } = createV2Sandbox(mockFetch, {
    wdaidt_mock_mode: false,
    wdaidt_gemini_api_key: 'AIzaSyTestLiveKey789'
  });
  exports.settingsState.mockMode = false;
  exports.settingsState.apiKey = 'AIzaSyTestLiveKey789';

  const res = await exports.postAnalyze(
    'Optimize this SQL query',
    'SELECT * FROM orders WHERE user_id = 5;',
    'req-live-gemini'
  );

  assert.equal(res.request_id, 'req-live-gemini');
  assert.equal(res.analysis.title, 'Live Gemini Diagnosis');
  assert.equal(res.analysis.blocks.length, 2);

  // Verification of direct Gemini REST call
  assert.ok(capturedUrl.includes('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'));
  assert.ok(!capturedUrl.includes('http://localhost'), 'Must not call localhost backend');
  assert.equal(capturedHeaders['x-goog-api-key'], 'AIzaSyTestLiveKey789');
  assert.equal(capturedBody.generationConfig?.responseMimeType, 'application/json');
});

test('pipeline_v2: Live mode throws API_KEY_MISSING with actionable message when key is not set', async () => {
  const { exports } = createV2Sandbox(null, { wdaidt_mock_mode: false, wdaidt_gemini_api_key: '' });
  exports.settingsState.mockMode = false;
  exports.settingsState.apiKey = '';

  await assert.rejects(
    async () => {
      await exports.postAnalyze('Prompt', 'Response', 'req-no-key');
    },
    (err) => err.code === 'API_KEY_MISSING' && err.message.includes('Gemini API key is not configured')
  );
});

test('pipeline_v2: status indicator updates correctly based on Mock Mode vs API Key state', () => {
  const { elements, exports } = createV2Sandbox(null);

  // 1. Initial without key and without mock mode
  exports.settingsState.mockMode = false;
  exports.settingsState.apiKey = '';
  exports.updateStatusIndicator();
  assert.equal(elements.backendLine.textContent, 'Gemini: API Key required');
  assert.ok(elements.statusDot.className.includes('warning'));

  // 2. Mock mode enabled
  exports.settingsState.mockMode = true;
  exports.updateStatusIndicator();
  assert.equal(elements.backendLine.textContent, 'Mode: Mock (offline)');
  assert.ok(elements.statusDot.className.includes('connected'));

  // 3. API key saved and live mode
  exports.settingsState.mockMode = false;
  exports.settingsState.apiKey = 'AIzaSyValidKey';
  exports.updateStatusIndicator();
  assert.equal(elements.backendLine.textContent, 'Gemini: Ready');
  assert.ok(elements.statusDot.className.includes('connected'));
});

test('pipeline_v2: initSettings loads stored API key and immediately synchronizes UI status indicator', async () => {
  const { elements, exports } = createV2Sandbox(null, {
    wdaidt_gemini_api_key: 'AIzaSyStoredKeyFromPreviousSession',
    wdaidt_mock_mode: false
  });

  // initSettings loads from chrome.storage.local
  await exports.initSettings();

  assert.equal(exports.settingsState.apiKey, 'AIzaSyStoredKeyFromPreviousSession');
  assert.equal(elements.backendLine.textContent, 'Gemini: Ready');
  assert.ok(elements.statusDot.className.includes('connected'));
  assert.equal(elements.apiKeyStatus.textContent, 'Key saved locally');
});

test('pipeline_v2: typing in apiKeyInput immediately updates status indicator and apiKeyStatus', async () => {
  const { elements, exports } = createV2Sandbox(null, {
    wdaidt_gemini_api_key: '',
    wdaidt_mock_mode: false
  });

  await exports.initSettings();
  assert.equal(elements.backendLine.textContent, 'Gemini: API Key required');
  assert.ok(elements.statusDot.className.includes('warning'));

  // User types key into input
  elements.apiKeyInput.value = 'AIzaSyEnteredKeyLive';
  elements.apiKeyInput.dispatchEvent('input');

  assert.equal(exports.settingsState.apiKey, 'AIzaSyEnteredKeyLive');
  assert.equal(elements.backendLine.textContent, 'Gemini: Ready');
  assert.ok(elements.statusDot.className.includes('connected'));
  assert.equal(elements.apiKeyStatus.textContent, 'Key saved locally');

  // User clicks clear
  elements.apiKeyClearBtn.dispatchEvent('click');
  assert.equal(exports.settingsState.apiKey, '');
  assert.equal(elements.backendLine.textContent, 'Gemini: API Key required');
  assert.ok(elements.statusDot.className.includes('warning'));
  assert.equal(elements.apiKeyStatus.textContent, 'Key not configured');
});

test('pipeline_v2: zero runtime calls to http://localhost:8000 when analyzing', async () => {
  const requestedUrls = [];
  const mockFetch = async (url) => {
    requestedUrls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"title":"T","blocks":[{"type":"divider"}]}' }] } }]
      })
    };
  };

  const { exports } = createV2Sandbox(mockFetch, {
    wdaidt_mock_mode: false,
    wdaidt_gemini_api_key: 'AIzaSyValidKey'
  });
  exports.settingsState.apiKey = 'AIzaSyValidKey';
  exports.settingsState.mockMode = false;

  await exports.postAnalyze('Question', 'Answer', 'req-check-urls');

  for (const url of requestedUrls) {
    assert.ok(!url.includes('localhost'), `Unexpected localhost request: ${url}`);
    assert.ok(!url.includes('127.0.0.1'), `Unexpected 127.0.0.1 request: ${url}`);
  }
});

test('pipeline_v2 regression: postAnalyze restores mockMode from storage when settingsState in-memory was uninitialized', async () => {
  const { exports, store } = createV2Sandbox(null, {
    wdaidt_mock_mode: true,
    wdaidt_gemini_api_key: ''
  });

  // Simulate uninitialized in-memory state
  exports.settingsState.mockMode = false;
  exports.settingsState.apiKey = '';

  const result = await exports.postAnalyze('What is the capital of France?', 'The capital of France is Paris.', 'req-mock-restore');
  assert.ok(result);
  assert.ok(result.analysis);
  assert.equal(exports.settingsState.mockMode, true);
});

test('pipeline_v2 regression: closing settings drawer persists apiKeyInput value to state and storage', async () => {
  const { elements, exports, store } = createV2Sandbox(null, {
    wdaidt_mock_mode: false,
    wdaidt_gemini_api_key: ''
  });

  await exports.initSettings();
  assert.equal(elements.backendLine.textContent, 'Gemini: API Key required');

  // Value placed in input (e.g. paste without separate input event)
  elements.apiKeyInput.value = 'AIzaSyPastedWithoutInputEvent';
  elements.settingsCloseBtn.dispatchEvent('click');

  assert.equal(exports.settingsState.apiKey, 'AIzaSyPastedWithoutInputEvent');
  assert.equal(store.wdaidt_gemini_api_key, 'AIzaSyPastedWithoutInputEvent');
  assert.equal(elements.backendLine.textContent, 'Gemini: Ready');
  assert.ok(elements.statusDot.className.includes('connected'));
});
