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
  if (t.includes('.')) {
    const parts = t.split('.');
    const tagPart = parts[0].trim();
    if (tagPart && tagPart !== '*' && el.tagName !== tagPart.toUpperCase()) return false;
    const cls = parts.slice(1);
    const actual = String(el._attrs?.class || el.className || '').split(/\s+/);
    return cls.every((c) => actual.includes(c));
  }
  if (t.includes('#')) {
    const parts = t.split('#');
    const tagPart = parts[0].trim();
    if (tagPart && tagPart !== '*' && el.tagName !== tagPart.toUpperCase()) return false;
    const id = parts[1];
    const actual = String(el._attrs?.id || el.id || '');
    return actual === id;
  }
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

function makeEl({ tag = 'div', attrs = {}, text = '', children = [], shadow = null, inner = null, rects = true, pos = 'static' }) {
  const el = {
    tagName: String(tag).toUpperCase(),
    _attrs: { ...attrs },
    _text: text,
    _inner: inner,
    _rects: rects,
    _pos: pos,
    children: [],
    parent: null,
    shadowRoot: null,
    _order: ORDER++,
    get className() { return this._attrs['class'] || ''; },
    get id() { return this._attrs['id'] || ''; },
    get innerText() {
      if (this._inner != null) return this._inner;
      if (this._text) return this._text;
      return this.children.map((c) => c.innerText).filter(Boolean).join('\n');
    },
    get textContent() {
      if (this._text) return this._text;
      return this.children.map((c) => c.textContent).filter(Boolean).join('\n');
    },
    getClientRects() {
      if (this._rects === false) return [];
      if (typeof this._rects === 'object' && this._rects !== null) {
        return Array.isArray(this._rects) ? this._rects : [this._rects];
      }
      return [{ width: 100, height: 50 }];
    },
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
      // Matches real DOM semantics: self is tested first, then ancestors.
      let node = this;
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
      getComputedStyle: (el) => ({
        position: (el && el._pos) || 'static',
        visibility: 'visible',
        display: 'block',
      }),
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

// ---- Accessibility / chrome-noise exclusion (bug report) -------------------------
const DRAGGABLE_ANNOUNCEMENT =
  'To pick up a draggable item, press the space bar. While dragging, use the arrow keys to move the item. Press space again to drop the item in its new position, or press escape to cancel.';

function liveAnnouncer(text) {
  // Hidden live region: nothing rendered (innerText ''), full textContent.
  return makeEl({ attrs: { 'aria-live': 'polite' }, text, inner: '', rects: false });
}

test('bug report: menu chrome + hidden live-region text are never paired', async () => {
  const { send } = loadScript({
    elements: [
      makeEl({
        attrs: { role: 'menu' },
        children: [makeEl({ text: 'Clarify Auto Analyze Request ID' })],
      }),
      liveAnnouncer(DRAGGABLE_ANNOUNCEMENT),
      makeEl({ attrs: { role: 'tooltip' }, text: 'Drag the handle to reorder this long conversation thread item' }),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, '');
  assert.equal(res.response, '');
  assert.ok(!res.response.includes('draggable'));
  assert.ok(!res.prompt.includes('Clarify Auto Analyze'));
});

test('genuine pair wins over live-region + tooltip + hidden noise', async () => {
  const { send } = loadScript({
    elements: [
      liveAnnouncer(DRAGGABLE_ANNOUNCEMENT),
      makeEl({ attrs: { role: 'tooltip' }, text: 'Drag the handle to reorder this long conversation thread item' }),
      user('Should I learn Python or Java for AI?'),
      assistant('Python is generally recommended because of its AI ecosystem.'),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.strategy, 'role-attributes');
  assert.equal(res.prompt, 'Should I learn Python or Java for AI?');
  assert.equal(res.response, 'Python is generally recommended because of its AI ecosystem.');
});

test('aria-hidden subtree is excluded even with role attributes', async () => {
  const hidden = makeEl({ attrs: { 'aria-hidden': 'true' }, text: '' });
  const u = makeEl({ attrs: { 'data-message-author-role': 'user' }, text: 'hidden draft question text here' });
  u.parent = hidden;
  hidden.children = [u];
  const { send } = loadScript({ elements: [hidden] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, '');
  assert.equal(res.response, '');
});

test('role=status announcer is excluded from structural fallback', async () => {
  const { send } = loadScript({
    elements: [
      makeEl({ attrs: { role: 'status' }, text: 'ChatGPT is generating a very long response for your request right now' }),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, '');
  assert.equal(res.response, '');
});

test('assistant-only page never invents a prompt', async () => {
  const { send } = loadScript({
    elements: [assistant('Paris is the capital of France, in Europe.')],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, '');
  assert.equal(res.response, 'Paris is the capital of France, in Europe.');
  assert.equal(res.paired, false);
});

test('dynamically grown message text is captured on re-read', async () => {
  const u = user('Explain recursion briefly please');
  const a = assistant('Recursion is');
  const { send } = loadScript({ elements: [u, a] });
  const before = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(before.response, 'Recursion is');
  a._text = 'Recursion is when a function calls itself with a smaller input.';
  const after = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(after.prompt, 'Explain recursion briefly please');
  assert.equal(after.response, 'Recursion is when a function calls itself with a smaller input.');
});

test('fixed-position overlay portal is excluded from structural fallback', async () => {
  const main = makeEl({
    tag: 'main',
    children: [
      makeEl({ text: 'Is it raining in Chennai right now or asking about another place?' }),
      makeEl({ text: 'Rainfall is expected across parts of Tamil Nadu through the coming days, so stay indoors during thunder.' }),
    ],
  });
  const portal = makeEl({
    text: 'To pick up a draggable item, press the space bar. While dragging, use the arrow keys to move the item.',
    pos: 'fixed',
  });
  const { send } = loadScript({ elements: [main, portal] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.strategy, 'content-blocks');
  assert.match(res.prompt, /raining in Chennai/);
  assert.match(res.response, /Tamil Nadu/);
  assert.ok(!res.prompt.includes('draggable'));
  assert.ok(!res.response.includes('draggable'));
  assert.equal(res.paired, true);
});

test('content-blocks refuses a lone block instead of inventing a prompt', async () => {
  const { send } = loadScript({
    elements: [
      makeEl({ text: 'To pick up a draggable item, press the space bar. While dragging, use the arrow keys to move the item around.' }),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, '');
  assert.equal(res.response, '');
});

test('hidden attribute content is excluded', async () => {
  const { send } = loadScript({
    elements: [
      makeEl({ attrs: { hidden: '' }, text: 'This hidden panel explains a very long configuration workflow in detail' }),
    ],
  });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });
  assert.equal(res.prompt, '');
  assert.equal(res.response, '');
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

test('modern ChatGPT UI: real prompt and response captured inside main while sidebar and dnd announcement are excluded', async () => {
  // Sidebar with pinned chat
  const sidebar = makeEl({
    attrs: { id: 'sidebar', class: 'sidebar' },
    children: [
      makeEl({ attrs: { class: 'sidebar-item' }, text: 'Learn Python Fundamentals' }),
      makeEl({ attrs: { class: 'sidebar-item' }, text: 'Arch Linux Pros And Cons' }),
    ],
  });

  // dnd-kit announcer at body root
  const dndAnnouncer = makeEl({
    attrs: { id: 'DndDescribedBy-0' },
    rects: [{ width: 1, height: 1 }],
    text: 'To pick up a draggable item, press the space bar. While dragging, use the arrow keys to move the item. Press space again to drop the item in its new position, or press escape to cancel.',
  });

  // Modern ChatGPT conversation in <main>
  const main = makeEl({
    tag: 'main',
    children: [
      makeEl({
        attrs: { class: 'whitespace-pre-wrap' },
        text: 'i wanna start learning python',
      }),
      makeEl({
        attrs: { class: 'markdown prose' },
        text: "Brooo, let's do this properly. 🔥 Since you're aiming for AI/ML, Python is going to be one of your most important tools. But we're not going to spend three months watching tutorials and somehow forget how to write a loop.",
      }),
    ],
  });

  const { send } = loadScript({ elements: [sidebar, dndAnnouncer, main] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.ok, true);
  assert.equal(res.paired, true);
  assert.equal(res.prompt, 'i wanna start learning python');
  assert.match(res.response, /Brooo, let's do this properly/);
  assert.ok(!res.prompt.includes('draggable'));
  assert.ok(!res.response.includes('draggable'));
  assert.ok(!res.prompt.includes('Learn Python Fundamentals'));
  assert.ok(!res.response.includes('Learn Python Fundamentals'));
});

test('modern ChatGPT UI: interactive quiz/widget assistant turn with radio form is paired with prompt', async () => {
  const userTurn = makeEl({
    attrs: { class: 'whitespace-pre-wrap' },
    text: 'i wanna start learning java',
  });

  const quizForm = makeEl({
    tag: 'form',
    text: '3. How much time can you give Java daily? 1 hour. Start Lesson 1 ->',
  });

  const proseText = makeEl({
    attrs: { class: 'markdown prose' },
    text: "We'll learn one concept at a time, write code, solve small exercises, and review your answers before moving on.",
  });

  const copyBtn = makeEl({
    tag: 'button',
    attrs: { 'aria-label': 'Copy' },
    text: 'Copy',
  });

  const asstTurn = makeEl({
    tag: 'article',
    attrs: { 'data-testid': 'conversation-turn-3', 'aria-live': 'polite' },
    children: [quizForm, proseText, copyBtn],
  });

  const main = makeEl({
    tag: 'main',
    children: [userTurn, asstTurn],
  });

  const { send } = loadScript({ elements: [main] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.ok, true);
  assert.equal(res.paired, true);
  assert.equal(res.prompt, 'i wanna start learning java');
  assert.match(res.response, /learn one concept at a time/);
});
test('modern ChatGPT UI: subsequent turn in multi-turn conversation captures the latest exchange, not the first', async () => {
  // Outer container wrapping both turns
  const turn1User = makeEl({
    attrs: { class: 'whitespace-pre-wrap' },
    text: 'i wanna start learning python',
  });
  const turn1Asst = makeEl({
    attrs: { class: 'markdown prose' },
    text: "Brooo, let's do this properly.",
  });
  const turn2User = makeEl({
    attrs: { class: 'whitespace-pre-wrap' },
    text: 'i will start learning java guide me',
  });
  const turn2Asst = makeEl({
    attrs: { class: 'markdown prose' },
    text: "Worked for 11s\nKrishna, let's do this properly. We're going to learn Java from fundamentals.",
  });

  const main = makeEl({
    tag: 'main',
    attrs: { class: 'prose max-w-none' },
    children: [turn1User, turn1Asst, turn2User, turn2Asst],
  });

  const { send } = loadScript({ elements: [main] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.ok, true);
  assert.equal(res.paired, true);
  assert.equal(res.prompt, 'i will start learning java guide me');
  assert.match(res.response, /We're going to learn Java/);
});

test('modern ChatGPT UI: client-side SPA navigation from old chat to new chat captures the active chat', async () => {
  // Stale lingering main from previous chat (hidden/unrendered)
  const oldMain = makeEl({
    tag: 'main',
    attrs: { class: 'hidden' },
    rects: false,
    children: [
      makeEl({
        attrs: { class: 'whitespace-pre-wrap' },
        rects: false,
        text: 'i wanna start learning python',
      }),
    ],
  });

  // Active main from new chat
  const newMain = makeEl({
    tag: 'main',
    children: [
      makeEl({
        attrs: { class: 'whitespace-pre-wrap' },
        text: 'hi',
      }),
      makeEl({
        attrs: { class: 'markdown' },
        text: "Krishnaaa! 😂🤝 What's up, bro? I'm here. What are we working on tonight?",
      }),
    ],
  });

  const { send } = loadScript({ elements: [oldMain, newMain] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.ok, true);
  assert.equal(res.paired, true);
  assert.equal(res.prompt, 'hi');
  assert.match(res.response, /Krishnaaa!/);
});

test('modern ChatGPT UI: fixed layout wrapper (fixed inset-0) does not reject genuine conversation turns', async () => {
  // SPA root layout shell with position: fixed
  const shell = makeEl({
    attrs: { class: 'fixed inset-0 flex' },
    pos: 'fixed',
    children: [
      makeEl({
        attrs: { class: 'whitespace-pre-wrap' },
        text: 'explain quicksort',
      }),
      makeEl({
        attrs: { class: 'markdown' },
        text: 'Quicksort is an efficient divide-and-conquer sorting algorithm.',
      }),
    ],
  });

  const { send } = loadScript({ elements: [shell] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.ok, true);
  assert.equal(res.paired, true);
  assert.equal(res.prompt, 'explain quicksort');
  assert.match(res.response, /divide-and-conquer/);
});

test('modern ChatGPT UI: short prompt ("hi") and assistant reply with nested pre/code block and bottom disclaimer are correctly paired', async () => {
  const userBubble = makeEl({
    attrs: { class: 'whitespace-pre-wrap' },
    text: 'hi',
  });

  const codeSnippet = makeEl({
    tag: 'pre',
    attrs: { class: 'whitespace-pre-wrap' },
    text: 'print("hello")',
  });

  const asstBubble = makeEl({
    attrs: { class: 'markdown prose w-full' },
    text: "Krishnaaa! 😂🤝 What's up, bro? What are we working on tonight? Java, DSA, a new project, or something completely different?",
    children: [codeSnippet],
  });

  const disclaimer = makeEl({
    attrs: { class: 'text-xs text-center' },
    text: 'ChatGPT can make mistakes. Check important info.',
  });

  const main = makeEl({
    tag: 'main',
    children: [userBubble, asstBubble, disclaimer],
  });

  const { send } = loadScript({ elements: [main] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.ok, true);
  assert.equal(res.paired, true);
  assert.equal(res.prompt, 'hi');
  assert.match(res.response, /Krishnaaa!/);
  assert.ok(!res.response.includes('ChatGPT can make mistakes'));
  assert.ok(!res.prompt.includes('ChatGPT can make mistakes'));
});

test('modern ChatGPT UI: feedback survey ("Is this conversation helpful so far?") is excluded and prompt with full assistant roadmap is captured', async () => {
  const userBubble = makeEl({
    attrs: { class: 'whitespace-pre-wrap' },
    text: 'i wanna start learning python',
  });

  const p1 = makeEl({
    tag: 'p',
    text: "Brooo, let's do this properly. 🔥 Since you're aiming for AI/ML, Python is going to be one of your most important tools.",
  });
  const p2 = makeEl({
    tag: 'p',
    text: "Phase 1: Python fundamentals. Phase 2: Strong Python.",
  });
  const p3 = makeEl({
    tag: 'p',
    text: "Your mission: Write day01.py, run it, and send me your code. I'll review it like a coding buddy, explain any mistakes, and then we'll move to the next concept. One working program at a time.",
  });

  const asstBubble = makeEl({
    attrs: { class: 'markdown prose w-full' },
    children: [p1, p2, p3],
  });

  const surveyWidget = makeEl({
    attrs: { class: 'feedback-survey' },
    text: 'Is this conversation helpful so far?',
  });

  const main = makeEl({
    tag: 'main',
    children: [userBubble, asstBubble, surveyWidget],
  });

  const { send } = loadScript({ elements: [main] });
  const res = await send({ type: 'WDAIDT_GET_LATEST' });

  assert.equal(res.ok, true);
  assert.equal(res.paired, true);
  assert.equal(res.prompt, 'i wanna start learning python');
  assert.match(res.response, /Brooo, let's do this properly/);
  assert.match(res.response, /Your mission: Write day01.py/);
  assert.ok(!res.response.includes('helpful so far'));
  assert.ok(!res.prompt.includes('helpful so far'));
  assert.ok(!res.prompt.includes('Your mission'));
});
