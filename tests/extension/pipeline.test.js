// Capture-to-analysis pipeline test — uses the REAL content script and the
// REAL shared contract constants (no reimplementations of extraction logic).
// It proves: extraction yields two distinct, non-empty, well-formed fields
// that satisfy the backend's acceptance rules, partial captures stay
// partial (never substituted), and accessibility noise never becomes a field.
//
// Boundary (stated, not hidden): chrome.tabs messaging, fetch(), and the
// Python backend process need a browser/server, so this test verifies
// everything up to the request payload. The backend side of the identical
// rules is proven by tests/backend/test_analyze.py (200 on valid pairs,
// 422 INVALID_REQUEST on empty/whitespace).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..', '..');
const CONTENT_SRC = fs.readFileSync(
  path.join(ROOT, 'extension', 'src', 'content', 'chatgpt.js'),
  'utf8'
);
const CONFIG_SRC = fs.readFileSync(
  path.join(ROOT, 'extension', 'src', 'shared', 'config.js'),
  'utf8'
);

let ORDER = 0;
function makeEl({ tag = 'div', attrs = {}, text = '', children = [], inner = null, rects = true }) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _attrs: { ...attrs },
    _text: text,
    _inner: inner,
    _rects: rects,
    children: [],
    parent: null,
    shadowRoot: null,
    _order: ORDER++,
    get innerText() { return this._inner != null ? this._inner : this._text; },
    get textContent() { return this._text; },
    getClientRects() { return this._rects ? [{}] : []; },
    getAttribute(n) {
      return Object.prototype.hasOwnProperty.call(this._attrs, n) ? this._attrs[n] : null;
    },
    querySelector(sel) {
      return this.querySelectorAll(sel)[0] || null;
    },
    querySelectorAll(sel) {
      const out = [];
      const walk = (list) => {
        for (const c of list) {
          if (matchesAny(c, sel)) out.push(c);
          walk(c.children || []);
        }
      };
      walk(this.children || []);
      return out;
    },
    closest(sel) {
      let node = this;
      while (node) {
        if (matchesAny(node, sel)) return node;
        node = node.parent;
      }
      return null;
    },
    contains(o) {
      if (o === this) return true;
      return this.querySelectorAll('*').includes(o);
    },
    compareDocumentPosition(o) {
      if (o === this) return 0;
      return o._order < this._order ? 2 : 4;
    },
  };
  for (const c of children) {
    c.parent = el;
    el.children.push(c);
  }
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
  if (t.startsWith('.') || t.startsWith('#')) return false;
  return el.tagName === t.toUpperCase();
}

function matchesAny(el, selector) {
  return String(selector).split(',').some((part) => matchToken(el, part));
}

function loadPage(elements) {
  ORDER = 0;
  const flat = [];
  const restamp = (list) => {
    for (const e of list) {
      e._order = flat.length;
      flat.push(e);
      restamp(e.children || []);
    }
  };
  restamp(elements);
  let handler = null;
  const sandbox = {
    console,
    chrome: { runtime: { onMessage: { addListener(fn) { handler = fn; } } } },
    document: {
      hidden: false,
      querySelectorAll(sel) {
        return flat.filter((e) => matchesAny(e, sel));
      },
      querySelector(sel) {
        return this.querySelectorAll(sel)[0] || null;
      },
      body: makeEl({ tag: 'body' }),
    },
    window: {
      location: { hostname: 'chatgpt.com', href: 'https://chatgpt.com/c/pipe' },
      __WDAIDT_DEBUG__: [],
      __WDAIDT__: undefined,
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CONTENT_SRC, sandbox, { filename: 'chatgpt.js' });
  vm.runInContext(CONFIG_SRC, sandbox, { filename: 'config.js' });
  assert.ok(handler, 'listener registered');
  assert.ok(sandbox.WDAIDT_CONFIG, 'shared config loaded');
  const capture = () =>
    new Promise((resolve) => {
      handler({ type: 'WDAIDT_GET_LATEST' }, {}, (resp) => resolve(resp));
    });
  return { capture, config: sandbox.WDAIDT_CONFIG };
}

const PROMPT = [
  'Should I learn Python or Java for AI?',
  '',
  'I have two years of Java backend experience and want to move into ML.',
].join('\n');
const RESPONSE = [
  'Python is generally recommended because of its strong AI ecosystem.',
  '',
  'Libraries like PyTorch and scikit-learn, plus an active research community, make it the default choice.',
  'Your Java background still helps with tooling and large systems.',
].join('\n');
const ANNOUNCEMENT =
  'To pick up a draggable item, press the space bar. While dragging, use the arrow keys.';

test('pipeline: real extraction yields distinct multi-paragraph fields', async () => {
  const { capture } = loadPage([
    makeEl({ attrs: { 'data-message-author-role': 'user' }, text: PROMPT }),
    makeEl({ attrs: { 'data-message-author-role': 'assistant' }, text: RESPONSE }),
  ]);
  const res = await capture();
  assert.equal(res.ok, true);
  assert.equal(res.prompt, PROMPT);
  assert.equal(res.response, RESPONSE);
  assert.notEqual(res.prompt, res.response);
  assert.ok(res.prompt.includes('\n\n'), 'paragraph breaks preserved in prompt');
  assert.ok(res.response.includes('\n\n'), 'paragraph breaks preserved in response');
  assert.equal(res.paired, true);
});

test('pipeline: fields satisfy backend acceptance rules and are request-ready', async () => {
  const { capture, config } = loadPage([
    makeEl({ attrs: { 'data-message-author-role': 'user' }, text: PROMPT }),
    makeEl({ attrs: { 'data-message-author-role': 'assistant' }, text: RESPONSE }),
    makeEl({ attrs: { 'aria-live': 'polite' }, text: ANNOUNCEMENT, inner: '', rects: false }),
  ]);
  const res = await capture();
  // Same rules the backend enforces (422 otherwise): both non-blank.
  assert.ok(res.prompt.trim().length > 0);
  assert.ok(res.response.trim().length > 0);
  // Same size limits the sidebar trims to (shared contract constants).
  assert.ok(res.prompt.length <= config.MAX_PROMPT_CHARS);
  assert.ok(res.response.length <= config.MAX_RESPONSE_CHARS);
  // The response is the assistant message — never the prompt, never chrome noise.
  assert.notEqual(res.response, res.prompt);
  assert.ok(!res.response.includes('draggable'));
  // A well-formed request body round-trips through JSON.
  const body = {
    prompt: res.prompt.trim().slice(0, config.MAX_PROMPT_CHARS),
    response: res.response.trim().slice(0, config.MAX_RESPONSE_CHARS),
    request_id: crypto.randomUUID(),
  };
  const roundTripped = JSON.parse(JSON.stringify(body));
  assert.equal(roundTripped.prompt, body.prompt);
  assert.equal(roundTripped.response, body.response);
  assert.ok(roundTripped.request_id);
});

test('pipeline: missing assistant reply stays missing (never substituted)', async () => {
  const { capture } = loadPage([
    makeEl({ attrs: { 'data-message-author-role': 'user' }, text: 'Waiting on this answer still' }),
  ]);
  const res = await capture();
  assert.equal(res.prompt, 'Waiting on this answer still');
  assert.equal(res.response, '');
  assert.equal(res.paired, false);
  // The sidebar must show "(not captured)" here, not copy the prompt over.
  assert.notEqual(res.response, res.prompt);
});

test('pipeline: empty page yields explicit empty result, not garbage', async () => {
  const { capture } = loadPage([]);
  const res = await capture();
  assert.equal(res.ok, true);
  assert.equal(res.prompt, '');
  assert.equal(res.response, '');
});
