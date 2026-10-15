// Auto Analyze + stale-guard tests. No dependencies.
// Run: node --test tests/extension/auto.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const SRC = fs.readFileSync(
  path.join(ROOT, 'extension', 'src', 'content', 'chatgpt.js'),
  'utf8'
);
const SHARED = require(path.join(ROOT, 'extension', 'src', 'shared', 'messages.js'));

// ---- Shared contract ----------------------------------------------------------
test('shared contract exposes trigger type + stale guard', () => {
  assert.equal(SHARED.WDAIDT_MESSAGES.AUTO_ANALYZE_TRIGGER, 'WDAIDT_AUTO_ANALYZE_TRIGGER');
  const { wdaidtIsStaleResult } = SHARED;
  assert.equal(wdaidtIsStaleResult('a', { request_id: 'a' }), false); // current
  assert.equal(wdaidtIsStaleResult('b', { request_id: 'a' }), true); // superseded
  assert.equal(wdaidtIsStaleResult('b', {}), false); // missing echo: never drop
  assert.equal(wdaidtIsStaleResult(null, { request_id: 'a' }), false); // no expectation
  assert.equal(wdaidtIsStaleResult('b', null), false);
});

// ---- Content-script watcher harness --------------------------------------------
let ORDER = 0;
function makeEl({ tag = 'div', attrs = {}, text = '' }) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _attrs: { ...attrs },
    _text: text,
    children: [],
    parent: null,
    shadowRoot: null,
    _order: ORDER++,
    get innerText() { return this._text; },
    get textContent() { return this._text; },
    getAttribute(n) {
      return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null;
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    closest() { return null; },
    contains(o) { return o === this; },
    compareDocumentPosition(o) {
      if (o === this) return 0;
      return o._order < this._order ? 2 : 4;
    },
  };
  return el;
}

function matchToken(el, token) {
  let t = token.trim();
  if (!t || t.startsWith(':scope')) return false;
  if (t === '*') return true;
  if (t.includes(' ')) t = t.split(/\s+/).pop();
  if (t.includes('[')) {
    const tagPart = t.slice(0, t.indexOf('[')).trim();
    if (tagPart && tagPart !== '*' && el.tagName !== tagPart.toUpperCase()) return false;
    const m = t.match(/\[([^\]=\^\*]+)(\^=|\*=|=)?"?([^"\]]*)"?\]/);
    if (!m) return false;
    const [, attr, op, val] = m;
    const has = Object.prototype.hasOwnProperty.call(el._attrs, attr);
    if (!op) return has;
    if (!has) return false;
    const actual = String(el._attrs[attr]);
    if (op === '=') return actual === val;
    if (op === '^=') return actual.startsWith(val);
    if (op === '*=') return actual.includes(val);
    return false;
  }
  return el.tagName === t.toUpperCase();
}

function loadWatcher({ elements, autoOn }) {
  ORDER = 0;
  const items = elements.map((e, i) => {
    e._order = i;
    return e;
  });
  const sent = [];
  let msgHandler = null;
  let obsCb = null;
  let observed = null;
  const bodyStub = makeEl({ tag: 'body' });
  bodyStub.children = items;
  for (const e of items) e.parent = bodyStub;
  const sandbox = {
    console,
    __WDAIDT_AUTO_DEBOUNCE_MS: 30,
    setTimeout: (fn, ms, ...args) => setTimeout(fn, ms, ...args),
    clearTimeout: (id) => clearTimeout(id),
    MutationObserver: class {
      constructor(cb) { obsCb = cb; }
      observe(t, o) { observed = { t, o }; }
      disconnect() { observed = null; }
    },
    chrome: {
      runtime: {
        onMessage: { addListener(fn) { msgHandler = fn; } },
        sendMessage(msg) { sent.push(msg); return Promise.resolve({}); },
      },
      storage: {
        local: { get: async () => ({ wdaidt_auto_analyze: autoOn }) },
        onChanged: { addListener() {} },
      },
    },
    document: {
      hidden: false,
      documentElement: makeEl({ tag: 'html' }),
      body: bodyStub,
      querySelectorAll(sel) {
        return items.filter((e) =>
          String(sel).split(',').some((p) => matchToken(e, p))
        );
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
    },
    window: {
      location: { hostname: 'chatgpt.com', href: 'https://chatgpt.com/c/x' },
      __WDAIDT_DEBUG__: [],
      __WDAIDT__: undefined,
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'chatgpt.js' });
  assert.ok(msgHandler, 'listener registered');
  const send = (message) =>
    new Promise((resolve) => {
      const ret = msgHandler(message, {}, (resp) => resolve(resp));
      if (ret === undefined) resolve(undefined);
    });
  const fireMutations = () => { if (obsCb) obsCb([]); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  return { send, sent, fireMutations, sleep, items, get observed() { return observed; } };
}

const roleUser = (text) =>
  makeEl({ attrs: { 'data-message-author-role': 'user' }, text });
const roleAsst = (text) =>
  makeEl({ attrs: { 'data-message-author-role': 'assistant' }, text });

test('watcher notifies a settled pair when toggle is ON', async () => {
  const h = loadWatcher({
    autoOn: true,
    elements: [roleUser('Which project?'), roleAsst('Choose the twin for data science.')],
  });
  await h.sleep(120); // startup schedule + 30ms debounce
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].type, 'WDAIDT_AUTO_ANALYZE_TRIGGER');
  assert.equal(h.sent[0].prompt, 'Which project?');
  assert.equal(h.sent[0].response, 'Choose the twin for data science.');
});

test('watcher does not re-notify an unchanged snapshot', async () => {
  const h = loadWatcher({
    autoOn: true,
    elements: [roleUser('Q?'), roleAsst('A.')],
  });
  await h.sleep(120);
  assert.equal(h.sent.length, 1);
  h.fireMutations(); // unrelated DOM churn, same exchange
  await h.sleep(120);
  assert.equal(h.sent.length, 1);
});

test('watcher fires again for a new exchange', async () => {
  const h = loadWatcher({
    autoOn: true,
    elements: [roleUser('Q1?'), roleAsst('A1.')],
  });
  await h.sleep(120);
  assert.equal(h.sent.length, 1);
  const u2 = roleUser('Q2?');
  const a2 = roleAsst('A2 with more detail.');
  u2._order = 10;
  a2._order = 11;
  h.items.push(u2, a2);
  h.fireMutations();
  await h.sleep(120);
  assert.equal(h.sent.length, 2);
  assert.equal(h.sent[1].prompt, 'Q2?');
  assert.equal(h.sent[1].response, 'A2 with more detail.');
});

test('watcher stays silent when toggle is OFF', async () => {
  const h = loadWatcher({
    autoOn: false,
    elements: [roleUser('Q?'), roleAsst('A.')],
  });
  h.fireMutations();
  await h.sleep(120);
  assert.equal(h.sent.length, 0);
});

test('AUTO ON/OFF runtime messages arm and disarm the watcher', async () => {
  const h = loadWatcher({
    autoOn: false,
    elements: [roleUser('Q?'), roleAsst('A.')],
  });
  const on = await h.send({ type: 'WDAIDT_AUTO_ANALYZE_ON' });
  assert.equal(on.auto, true);
  h.fireMutations();
  await h.sleep(120);
  assert.equal(h.sent.length, 1);
  const off = await h.send({ type: 'WDAIDT_AUTO_ANALYZE_OFF' });
  assert.equal(off.auto, false);
  h.fireMutations();
  await h.sleep(120);
  assert.equal(h.sent.length, 1); // no second notification
});
