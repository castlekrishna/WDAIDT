// Capture tests — ChatGPT DOM fixtures for extension/src/content/chatgpt.js
// No dependencies. Run: node --test tests/extension/capture.test.js
// Loads the real content script in a vm sandbox with a minimal DOM stub
// (light DOM + open shadow roots + tiny selector engine).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'extension', 'src', 'content', 'chatgpt.js'),
  'utf8'
);

// ---- Minimal DOM stub -------------------------------------------------------
let ORDER = 0;
function orderIndex(el) { return el._order; }

function matchToken(el, token) {
  let t = token.trim();
  if (!t || t.startsWith(':scope')) return false;
  if (t === '*') return true;
  if (t.includes(' ')) t = t.split(/\s+/).pop(); // descendant: match last token
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

function subtreeList(nodes) {
  const out = [];
  const walk = (list) => {
    for (const e of list) {
      out.push(e);
      walk(e.children || []);
      if (e.shadowRoot) walk(e.shadowRoot.children || []);
    }
  };
  walk(nodes);
  return out;
}

function makeEl({ tag = 'div', attrs = {}, text = '', children = [], shadow = null }) {
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
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this._attrs, name)
        ? this._attrs[name]
        : null;
    },
    querySelector(sel) {
      const all = this.querySelectorAll(sel);
      return all[0] || null;
    },
    querySelectorAll(sel) {
      return subtreeList(this.children).filter((e) => matchesAny(e, sel));
    },
    closest(sel) {
      let node = this.parent;
      while (node) {
        if (matchesAny(node, sel)) return node;
        node = node.parent;
      }
      return null;
    },
    contains(other) {
      if (other === this) return true;
      return subtreeList(this.children).includes(other);
    },
    compareDocumentPosition(other) {
      if (other === this) return 0;
      return orderIndex(other) < orderIndex(this) ? 2 : 4;
    },
  };
  for (const c of children) {
    c.parent = el;
    el.children.push(c);
  }
  if (shadow) {
    const root = {
      children: [],
      querySelectorAll(sel) {
        return subtreeList(this.children).filter((e) => matchesAny(e, sel));
      },
    };
    for (const c of shadow) {
      c.parent = null; // shadow children: parent chain stops at the root
      root.children.push(c);
    }
    el.shadowRoot = root;
  }
  return el;
}

function loadScript({ elements, hostname = 'chatgpt.com', href = 'https://chatgpt.com/c/abc' }) {
  ORDER = 0;
  // Re-stamp document order (creation order may interleave across fixtures).
  const stamped = [];
  const restamp = (list) => {
    for (const e of list) {
      e._order = stamped.length;
      stamped.push(e);
      restamp(e.children || []);
      if (e.shadowRoot) restamp(e.shadowRoot.children || []);
    }
  };
  restamp(elements);
  const light = subtreeList(elements).filter((e) => {
    // light-DOM only: exclude nodes living inside a shadow root
    let n = e;
    void n;
    return true;
  });
  // Build the light list properly: top-level walk without descending into shadow.
  const lightOnly = [];
  const walkLight = (list) => {
    for (const e of list) { lightOnly.push(e); walkLight(e.children || []); }
  };
  walkLight(elements);
  void light;

  let handler = null;
  const bodyStub = makeEl({ tag: 'body', children: [] });
  for (const e of elements) {
    e.parent = bodyStub;
    bodyStub.children.push(e);
  }
  const documentStub = {
    querySelectorAll(sel) {
      return lightOnly.filter((e) => matchesAny(e, sel));
    },
    querySelector(sel) {
      const all = this.querySelectorAll(sel);
      return all[0] || null;
    },
    body: bodyStub,
  };
  const sandbox = {
    console,
    chrome: {
      runtime: { onMessage: { addListener(fn) { handler = fn; } } },
    },
    document: documentStub,
    window: {
      location: { hostname, href },
      __WDAIDT_DEBUG__: [],
      __WDAIDT__: undefined,
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox, { filename: 'chatgpt.js' });
  assert.ok(handler, 'content script must register a message listener');
  const send = (message) =>
    new Promise((resolve) => {
      const ret = handler(message, {}, (resp) => resolve(resp));
      if (ret === undefined) resolve(undefined);
    });
  return { send, sandbox };
}

const user = (text, extra = {}) =>
  makeEl({ attrs: { 'data-message-author-role': 'user', ...extra }, text });
const assistant = (text, extra = {}) =>
  makeEl({ attrs: { 'data-message-author-role': 'assistant', ...extra }, text });
const turn = (testid, text) =>
  makeEl({ attrs: { 'data-testid': testid }, text });
const article = (text) => makeEl({ tag: 'article', text });
const mid = (id, text, children = []) =>
  makeEl({ attrs: { 'data-message-id': id }, text, children });
const btn = (label) =>
  makeEl({ tag: 'button', attrs: { 'aria-label': label }, text: label });

// ---- Strategy 1: role attributes --------------------------------------------
test('role attributes: latest pair captured in order', async () => {
  const { send } = loadScript({
    elements: [
      user('Should I learn Python or Java for AI?'),
      assistant('Python is generally recommended because of its AI ecosystem.'),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.ok, true);
  assert.equal(res.prompt, 'Should I learn Python or Java for AI?');
  assert.equal(res.response, 'Python is generally recommended because of its AI ecosystem.');
  assert.equal(res.strategy, 'role-attributes');
  assert.equal(res.paired, true);
  assert.equal(res.userCount, 1);
  assert.equal(res.assistantCount, 1);
  assert.ok(res.fingerprint);
});

test('multi-turn with regenerated response: last user + last assistant', async () => {
  const { send } = loadScript({
    elements: [
      user('first question'),
      assistant('first answer'),
      user('second question'),
      assistant('second answer draft'),
      assistant('second answer final'),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, 'second question');
  assert.equal(res.response, 'second answer final');
  assert.equal(res.userCount, 2);
  assert.equal(res.assistantCount, 3);
  assert.equal(res.paired, true);
});

test('new user message with no reply yet: honest partial, not a stale pair', async () => {
  const { send } = loadScript({
    elements: [
      user('old question'),
      assistant('old answer'),
      user('just asked, no reply yet'),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, 'just asked, no reply yet');
  assert.equal(res.response, '');
  assert.equal(res.paired, false);
});

test('streaming: empty assistant node is skipped, prompt kept', async () => {
  const { send } = loadScript({
    elements: [user('Explain recursion'), assistant('   ')],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, 'Explain recursion');
  assert.equal(res.response, '');
  assert.equal(res.paired, false);
});

test('composer text inside a form is excluded', async () => {
  const form = makeEl({ tag: 'form', text: '' });
  const draft = makeEl({ attrs: { 'data-message-author-role': 'user' }, text: 'unsent composer draft' });
  draft.parent = form;
  form.children = [draft];
  const { send } = loadScript({ elements: [form, user('real question'), assistant('real answer')] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, 'real question');
  assert.equal(res.response, 'real answer');
});

test('role values are case-insensitive', async () => {
  const { send } = loadScript({
    elements: [
      makeEl({ attrs: { 'data-message-author-role': 'User' }, text: 'hi' }),
      makeEl({ attrs: { 'data-message-author-role': 'Assistant' }, text: 'hello' }),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, 'hi');
  assert.equal(res.response, 'hello');
});

// ---- Strategy 2: message-id + affordances ------------------------------------
test('message-id elements classified by action affordances', async () => {
  const { send } = loadScript({
    elements: [
      mid('u1', 'Which project should I choose for AI?', [btn('Edit message')]),
      mid('a1', 'Python is generally recommended because of its strong AI and machine learning ecosystem with many libraries.', [btn('Copy'), btn('Good response')]),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.strategy, 'message-id');
  assert.equal(res.prompt, 'Which project should I choose for AI?');
  assert.match(res.response, /Python is generally recommended/);
  assert.equal(res.paired, true);
});

// ---- Strategy 3/4: turns and articles -----------------------------------------
test('fallback: conversation-turn testids without role attributes', async () => {
  const { send } = loadScript({
    elements: [
      turn('conversation-turn-0', 'How do I fix it?'),
      turn('conversation-turn-1', 'What error message are you seeing?'),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.strategy, 'conversation-turns');
  assert.equal(res.prompt, 'How do I fix it?');
  assert.equal(res.response, 'What error message are you seeing?');
  assert.equal(res.paired, true);
});

test('fallback: article elements without role attributes', async () => {
  const { send } = loadScript({
    elements: [article('What is the capital of France?'), article('Paris.')],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.strategy, 'articles');
  assert.equal(res.prompt, 'What is the capital of France?');
  assert.equal(res.response, 'Paris.');
});

// ---- Strategy 5: structural content blocks -------------------------------------
test('structural fallback: plain divs in main pair by order', async () => {
  const main = makeEl({
    tag: 'main',
    children: [
      makeEl({ text: 'Which project should I choose for my AI coursework this semester?' }),
      makeEl({ text: 'Choose the traffic digital twin if you want data science and computer vision, or Argus for DevSecOps and backend engineering practice.' }),
    ],
  });
  const { send } = loadScript({ elements: [main] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.strategy, 'content-blocks');
  assert.match(res.prompt, /Which project/);
  assert.match(res.response, /traffic digital twin/);
  assert.equal(res.paired, true);
});

// ---- Shadow DOM ------------------------------------------------------------------
test('shadow DOM: role nodes inside open shadow roots are found', async () => {
  const host = makeEl({
    text: '',
    shadow: [
      user('shadow prompt about Python versus Java'),
      assistant('shadow answer recommending Python for AI work'),
    ],
  });
  const { send } = loadScript({ elements: [host] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, 'shadow prompt about Python versus Java');
  assert.equal(res.response, 'shadow answer recommending Python for AI work');
  assert.equal(res.paired, true);
});

test('shadow DOM outside main: plain-text thread found via content-blocks', async () => {
  const host = makeEl({
    text: '',
    shadow: [
      makeEl({ text: 'Which project should I choose for my AI coursework this semester?' }),
      makeEl({ text: 'Choose the traffic digital twin if you want data science and computer vision, or Argus for DevSecOps and backend engineering practice.' }),
    ],
  });
  const nav = makeEl({
    tag: 'nav',
    children: [
      makeEl({
        tag: 'a',
        attrs: { href: '/c/old-conversation' },
        children: [makeEl({ text: 'Previous discussion about traffic models and simulation' })],
      }),
    ],
  });
  const { send } = loadScript({ elements: [nav, host] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.strategy, 'content-blocks');
  assert.match(res.prompt, /Which project/);
  assert.match(res.response, /traffic digital twin/);
  assert.ok(!res.response.includes('Previous discussion'));
  assert.equal(res.paired, true);
  assert.ok(res.fingerprint);
  assert.equal(res.fingerprint.shadowRoots, 1);
  assert.equal(res.fingerprint.shadowHosts.length, 1);
  assert.ok(res.fingerprint.shadowHosts[0].childElements >= 2);
});

// ---- Empty / protocol ---------------------------------------------------------------
test('empty conversation: both empty, strategy and fingerprint reported', async () => {
  const { send } = loadScript({ elements: [] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.ok, true);
  assert.equal(res.prompt, '');
  assert.equal(res.response, '');
  assert.match(res.strategy, /role-attributes/);
  assert.ok(res.fingerprint);
  assert.equal(res.fingerprint.roleAttr, 0);
});

test('PING answers, unknown types are ignored', async () => {
  const { send } = loadScript({ elements: [user('q'), assistant('a')] });
  const ping = await send({ type: 'WDAIDT_PING' });
  assert.equal(ping.ok, true);
  assert.equal(ping.onChatGPT, true);
  const unknown = await send({ type: 'NOPE' });
  assert.equal(unknown, undefined);
});

test('non-ChatGPT host reports onChatGPT:false', async () => {
  const { send } = loadScript({
    elements: [user('q'), assistant('a')],
    hostname: 'example.com',
    href: 'https://example.com/',
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.onChatGPT, false);
  assert.equal(res.prompt, '');
  assert.equal(res.response, '');
});
