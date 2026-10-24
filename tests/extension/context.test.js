// V0.7 Multi-Context Analysis Tests
// Run with: node --test tests/extension/context.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'sidepanel', 'app.js'), 'utf8');
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'config.js'), 'utf8');
const CHATGPT_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'content', 'chatgpt.js'), 'utf8');

// Helper to normalize objects created across different VM realms
const toPlain = (val) => JSON.parse(JSON.stringify(val));

function mockEl(tag = 'div') {
  const classes = new Set();
  const el = {
    tagName: tag.toUpperCase(),
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
    textContent: '',
    hidden: false,
    attributes: {},
    children: [],
    listeners: {},
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] || null; },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    addEventListener(evt, fn) {
      if (!this.listeners[evt]) this.listeners[evt] = [];
      this.listeners[evt].push(fn);
    },
    querySelector: () => null,
  };
  return el;
}

function createSidepanelSandbox(initialStorage = {}) {
  const store = { ...initialStorage };
  const sandbox = {
    console: {
      debug: () => {},
      warn: () => {},
      error: () => {}
    },
    document: {
      createElement: (tag) => mockEl(tag),
      getElementById: () => mockEl('div'),
    },
    navigator: {
      clipboard: {
        async writeText() { return true; }
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
          }
        }
      },
      runtime: {
        onMessage: { addListener: () => {} }
      },
      tabs: {
        query: async () => []
      }
    },
    setTimeout: (fn) => setTimeout(fn, 0),
    clearTimeout: () => {},
    module: { exports: {} }
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CONFIG_SRC, sandbox);
  vm.runInContext(APP_SRC, sandbox);
  return { exports: sandbox.module.exports, sandbox, store };
}

// ---- 1. Settings & Fallback Behavior -----------------------------------------

test('context window: default setting is 5 previous exchanges', () => {
  const { exports } = createSidepanelSandbox();
  assert.equal(exports.parseValidContextWindow(undefined), 5);
  assert.equal(exports.parseValidContextWindow(null), 5);
  assert.equal(exports.parseValidContextWindow(''), 5);
});

test('context window: valid options (0, 3, 5, 10) are parsed correctly', () => {
  const { exports } = createSidepanelSandbox();
  assert.equal(exports.parseValidContextWindow(0), 0);
  assert.equal(exports.parseValidContextWindow('0'), 0);
  assert.equal(exports.parseValidContextWindow(3), 3);
  assert.equal(exports.parseValidContextWindow('3'), 3);
  assert.equal(exports.parseValidContextWindow(5), 5);
  assert.equal(exports.parseValidContextWindow('5'), 5);
  assert.equal(exports.parseValidContextWindow(10), 10);
  assert.equal(exports.parseValidContextWindow('10'), 10);
});

test('context window: invalid or unsupported values safely fall back to default', () => {
  const { exports } = createSidepanelSandbox();
  assert.equal(exports.parseValidContextWindow(-1), 5);
  assert.equal(exports.parseValidContextWindow(999), 5);
  assert.equal(exports.parseValidContextWindow('invalid'), 5);
  assert.equal(exports.parseValidContextWindow(NaN), 5);
});

test('context window: loads saved setting from storage or defaults to 5', async () => {
  const { exports: exp1 } = createSidepanelSandbox({ wdaidt_context_window: 10 });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(exp1.settingsState.contextWindow, 10);

  const { exports: exp2 } = createSidepanelSandbox({});
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(exp2.settingsState.contextWindow, 5);

  const { exports: exp3 } = createSidepanelSandbox({ wdaidt_context_window: 'invalid-val' });
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(exp3.settingsState.contextWindow, 5);
});

// ---- 2. Context Window Is a Maximum (Mandatory Scenarios) --------------------

test('context limit is zero and current exchange only is analyzed', () => {
  const { exports } = createSidepanelSandbox();
  const history = [
    { prompt: 'Earlier Q1', response: 'Earlier A1' },
    { prompt: 'Earlier Q2', response: 'Earlier A2' },
  ];
  const filtered = exports.filterContextExchanges(history, 0, 30000);
  assert.deepEqual(toPlain(filtered), []);
});

test('context limit is five and no previous exchanges exist', () => {
  const { exports } = createSidepanelSandbox();
  const filtered = exports.filterContextExchanges([], 5, 30000);
  assert.deepEqual(toPlain(filtered), []);
});

test('context limit is five and only one previous exchange exists', () => {
  const { exports } = createSidepanelSandbox();
  const history = [{ prompt: 'Q1', response: 'A1' }];
  const filtered = exports.filterContextExchanges(history, 5, 30000);
  assert.equal(filtered.length, 1);
  assert.deepEqual(toPlain(filtered[0]), { prompt: 'Q1', response: 'A1' });
});

test('context limit is five and only two previous exchanges exist', () => {
  const { exports } = createSidepanelSandbox();
  const history = [
    { prompt: 'Q1', response: 'A1' },
    { prompt: 'Q2', response: 'A2' },
  ];
  const filtered = exports.filterContextExchanges(history, 5, 30000);
  assert.equal(filtered.length, 2);
  assert.deepEqual(toPlain(filtered), history);
});

test('context limit is five and exactly five previous exchanges exist', () => {
  const { exports } = createSidepanelSandbox();
  const history = [
    { prompt: 'Q1', response: 'A1' },
    { prompt: 'Q2', response: 'A2' },
    { prompt: 'Q3', response: 'A3' },
    { prompt: 'Q4', response: 'A4' },
    { prompt: 'Q5', response: 'A5' },
  ];
  const filtered = exports.filterContextExchanges(history, 5, 30000);
  assert.equal(filtered.length, 5);
  assert.deepEqual(toPlain(filtered), history);
});

test('context limit is five and twelve previous exchanges exist: 5 most recent selected in order', () => {
  const { exports } = createSidepanelSandbox();
  const history = Array.from({ length: 12 }, (_, i) => ({
    prompt: `Question ${i + 1}`,
    response: `Answer ${i + 1}`,
  }));
  const filtered = exports.filterContextExchanges(history, 5, 30000);
  assert.equal(filtered.length, 5);
  // Must be questions 8, 9, 10, 11, 12 in chronological order
  assert.equal(filtered[0].prompt, 'Question 8');
  assert.equal(filtered[1].prompt, 'Question 9');
  assert.equal(filtered[2].prompt, 'Question 10');
  assert.equal(filtered[3].prompt, 'Question 11');
  assert.equal(filtered[4].prompt, 'Question 12');
});

test('historical exchanges remain in chronological order', () => {
  const { exports } = createSidepanelSandbox();
  const history = [
    { prompt: 'Step 1: Setup', response: 'Run npm init' },
    { prompt: 'Step 2: Dependencies', response: 'Run npm install' },
    { prompt: 'Step 3: Run', response: 'Run npm start' },
  ];
  const filtered = exports.filterContextExchanges(history, 3, 30000);
  assert.equal(filtered[0].prompt, 'Step 1: Setup');
  assert.equal(filtered[1].prompt, 'Step 2: Dependencies');
  assert.equal(filtered[2].prompt, 'Step 3: Run');
});

test('empty history or malformed entries are accepted safely without errors', () => {
  const { exports } = createSidepanelSandbox();
  assert.deepEqual(toPlain(exports.filterContextExchanges(null, 5, 30000)), []);
  assert.deepEqual(toPlain(exports.filterContextExchanges(undefined, 5, 30000)), []);
  assert.deepEqual(toPlain(exports.filterContextExchanges('not an array', 5, 30000)), []);

  const messyHistory = [
    null,
    { prompt: '', response: 'Missing prompt' },
    { prompt: 'Missing response', response: '   ' },
    { prompt: 'Valid Q', response: 'Valid A' },
    {},
  ];
  const filtered = exports.filterContextExchanges(messyHistory, 5, 30000);
  assert.equal(filtered.length, 1);
  assert.deepEqual(toPlain(filtered[0]), { prompt: 'Valid Q', response: 'Valid A' });
});

// ---- 3. Size Management & Budget Enforcement --------------------------------

test('size management: small history fits completely within budget', () => {
  const { exports } = createSidepanelSandbox();
  const history = [
    { prompt: 'Short Q1', response: 'Short A1' },
    { prompt: 'Short Q2', response: 'Short A2' },
  ];
  const filtered = exports.filterContextExchanges(history, 5, 10000);
  assert.equal(filtered.length, 2);
});

test('size management: oversized history drops older complete exchanges first', () => {
  const { exports } = createSidepanelSandbox();
  // Budget = 250 characters. Each exchange is 100 chars
  const ex1 = { prompt: 'P1'.padEnd(50, 'a'), response: 'R1'.padEnd(50, 'b') }; // 100 chars
  const ex2 = { prompt: 'P2'.padEnd(50, 'c'), response: 'R2'.padEnd(50, 'd') }; // 100 chars
  const ex3 = { prompt: 'P3'.padEnd(50, 'e'), response: 'R3'.padEnd(50, 'f') }; // 100 chars

  // ex1 + ex2 + ex3 = 300 chars > 250 chars budget
  // Priority: keep most recent complete (ex2 and ex3 = 200 chars), drop oldest (ex1)
  const filtered = exports.filterContextExchanges([ex1, ex2, ex3], 5, 250);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].prompt, ex2.prompt);
  assert.equal(filtered[1].prompt, ex3.prompt);
});

test('size management: no partial exchanges created when budget is exceeded', () => {
  const { exports } = createSidepanelSandbox();
  const ex1 = { prompt: 'P1'.padEnd(80, 'x'), response: 'R1'.padEnd(80, 'y') }; // 160 chars
  const ex2 = { prompt: 'P2'.padEnd(80, 'z'), response: 'R2'.padEnd(80, 'w') }; // 160 chars

  // Budget = 200 chars. ex2 takes 160. ex1 (160) does not fit whole.
  // Must NOT partially truncate ex1 into a broken exchange. ex1 must be dropped entirely.
  const filtered = exports.filterContextExchanges([ex1, ex2], 5, 200);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].prompt, ex2.prompt);
  assert.equal(filtered[0].response, ex2.response);
});

test('size management: correct chronological ordering preserved after dropping older exchanges', () => {
  const { exports } = createSidepanelSandbox();
  const ex1 = { prompt: 'P1'.padEnd(100, '.'), response: 'R1'.padEnd(100, '.') }; // 200 chars
  const ex2 = { prompt: 'P2'.padEnd(100, '.'), response: 'R2'.padEnd(100, '.') }; // 200 chars
  const ex3 = { prompt: 'P3'.padEnd(100, '.'), response: 'R3'.padEnd(100, '.') }; // 200 chars

  const filtered = exports.filterContextExchanges([ex1, ex2, ex3], 5, 450);
  assert.equal(filtered.length, 2);
  assert.equal(filtered[0].prompt, ex2.prompt);
  assert.equal(filtered[1].prompt, ex3.prompt);
});

// ---- 4. UI Transparency Badge -----------------------------------------------

test('badge text: zero context displays Current exchange only', () => {
  const { exports } = createSidepanelSandbox();
  assert.equal(exports.formatContextBadgeText(0), 'Current exchange only');
  assert.equal(exports.formatContextBadgeText(-1), 'Current exchange only');
  assert.equal(exports.formatContextBadgeText(null), 'Current exchange only');
});

test('badge text: 1 exchange displays singular Context: 1 previous exchange', () => {
  const { exports } = createSidepanelSandbox();
  assert.equal(exports.formatContextBadgeText(1), 'Context: 1 previous exchange');
});

test('badge text: multiple exchanges display plural Context: N previous exchanges', () => {
  const { exports } = createSidepanelSandbox();
  assert.equal(exports.formatContextBadgeText(2), 'Context: 2 previous exchanges');
  assert.equal(exports.formatContextBadgeText(5), 'Context: 5 previous exchanges');
  assert.equal(exports.formatContextBadgeText(10), 'Context: 10 previous exchanges');
});

// ---- 5. Content Script DOM Capture Integration ------------------------------

function loadCaptureScript(elements) {
  let ORDER = 0;
  const stamped = [];
  const restamp = (list) => {
    for (const e of list) {
      e._order = stamped.length;
      stamped.push(e);
      restamp(e.children || []);
    }
  };
  restamp(elements);

  const bodyStub = {
    tagName: 'BODY',
    children: elements,
    querySelectorAll: (sel) => elements.filter((e) => e.tagName === sel.toUpperCase()),
  };
  for (const e of elements) e.parent = bodyStub;

  const documentStub = {
    querySelectorAll: (sel) => elements.filter((e) => {
      if (sel.includes('data-message-author-role')) {
        return !!(e._attrs && (e._attrs['data-message-author-role'] || e._attrs['data-author-role']));
      }
      return e.tagName === sel.toUpperCase();
    }),
    querySelector: (sel) => documentStub.querySelectorAll(sel)[0] || null,
    body: bodyStub,
  };

  let handler = null;
  const sandbox = {
    console,
    chrome: {
      runtime: { onMessage: { addListener(fn) { handler = fn; } } },
    },
    document: documentStub,
    window: {
      location: { hostname: 'chatgpt.com', href: 'https://chatgpt.com/c/test-chat' },
      getComputedStyle: () => ({ position: 'static', visibility: 'visible', display: 'block' }),
      __WDAIDT_DEBUG__: [],
      __WDAIDT__: undefined,
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CHATGPT_SRC, sandbox);

  const send = (msg) => new Promise((resolve) => handler(msg, {}, (r) => resolve(r)));
  return { send, sandbox };
}

function makeRoleNode(role, text) {
  return {
    tagName: 'DIV',
    _attrs: { 'data-message-author-role': role },
    _text: text,
    children: [],
    get className() { return ''; },
    get id() { return ''; },
    get innerText() { return this._text; },
    get textContent() { return this._text; },
    getAttribute(name) { return this._attrs[name] || null; },
    compareDocumentPosition(other) { return this._order < other._order ? 4 : 2; },
    getClientRects() { return [{ width: 100, height: 20 }]; },
    closest: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
  };
}

test('capture: multi-turn conversation extracts history and current exchange separately', async () => {
  const elements = [
    makeRoleNode('user', 'First question'),
    makeRoleNode('assistant', 'First answer'),
    makeRoleNode('user', 'Second question'),
    makeRoleNode('assistant', 'Second answer'),
    makeRoleNode('user', 'Third question'),
    makeRoleNode('assistant', 'Third answer'),
  ];
  const { send } = loadCaptureScript(elements);
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.ok, true);
  // Current exchange is the latest turn
  assert.equal(res.prompt, 'Third question');
  assert.equal(res.response, 'Third answer');
  assert.equal(res.paired, true);

  // History contains the two preceding complete exchanges in chronological order
  assert.ok(Array.isArray(res.history));
  assert.equal(res.history.length, 2);
  assert.deepEqual(toPlain(res.history[0]), { prompt: 'First question', response: 'First answer' });
  assert.deepEqual(toPlain(res.history[1]), { prompt: 'Second question', response: 'Second answer' });
});

test('capture: multi-turn with regenerated response captures latest assistant draft for that turn', async () => {
  const elements = [
    makeRoleNode('user', 'Initial prompt'),
    makeRoleNode('assistant', 'Initial answer'),
    makeRoleNode('user', 'Refined prompt'),
    makeRoleNode('assistant', 'Refined draft 1'),
    makeRoleNode('assistant', 'Refined draft 2 (final)'),
  ];
  const { send } = loadCaptureScript(elements);
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.prompt, 'Refined prompt');
  assert.equal(res.response, 'Refined draft 2 (final)');
  assert.equal(res.history.length, 1);
  assert.deepEqual(toPlain(res.history[0]), { prompt: 'Initial prompt', response: 'Initial answer' });
});

test('capture: pending response leaves history intact while reporting current exchange as unpaired', async () => {
  const elements = [
    makeRoleNode('user', 'Past prompt'),
    makeRoleNode('assistant', 'Past response'),
    makeRoleNode('user', 'New question awaiting reply'),
  ];
  const { send } = loadCaptureScript(elements);
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.prompt, 'New question awaiting reply');
  assert.equal(res.response, '');
  assert.equal(res.paired, false);
  assert.equal(res.history.length, 1);
  assert.deepEqual(toPlain(res.history[0]), { prompt: 'Past prompt', response: 'Past response' });
});

// ---- 6. Settings Panel DOM Integration --------------------------------------

test('HTML: settings panel contains Context Window select with 0, 3, 5, 10 options', () => {
  const html = fs.readFileSync(
    path.join(__dirname, '..', '..', 'extension', 'src', 'sidepanel', 'index.html'),
    'utf8'
  );
  assert.ok(html.includes('id="contextWindowSelect"'), 'missing contextWindowSelect in index.html');
  assert.ok(html.includes('value="0"'), 'missing 0 previous exchanges option');
  assert.ok(html.includes('value="3"'), 'missing 3 previous exchanges option');
  assert.ok(html.includes('value="5"'), 'missing 5 previous exchanges option');
  assert.ok(html.includes('value="10"'), 'missing 10 previous exchanges option');
  assert.ok(html.includes('id="captureContextBadge"'), 'missing captureContextBadge in index.html');
});
