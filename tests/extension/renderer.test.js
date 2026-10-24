// V0.6 Dynamic Document Renderer & Settings Unit Tests
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'sidepanel', 'app.js'), 'utf8');
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'config.js'), 'utf8');

// Lightweight DOM element mock for testing rendering logic
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
    style: {},
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
    click() {
      (this.listeners['click'] || []).forEach((fn) => fn({ stopPropagation: () => {} }));
    },
    querySelector(sel) {
      if (sel.startsWith('.')) {
        const cls = sel.slice(1);
        const find = (node) => {
          if (node.classList && node.classList.contains(cls)) return node;
          for (const c of node.children) {
            const res = find(c);
            if (res) return res;
          }
          return null;
        };
        return find(this);
      }
      return this.children[0] || null;
    }
  };
  return el;
}

function createSandbox() {
  const store = {};
  const sandbox = {
    console: {
      debug: () => {},
      warn: () => {},
      error: () => {}
    },
    document: {
      createElement: (tag) => mockEl(tag),
      getElementById: (id) => mockEl('div')
    },
    navigator: {
      clipboard: {
        lastWritten: '',
        async writeText(t) {
          this.lastWritten = t;
          return true;
        }
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
  return { exports: sandbox.module.exports, sandbox };
}

test('renderHeading: creates correct heading level and textContent', () => {
  const { exports } = createSandbox();
  const el = exports.renderHeading({ type: 'heading', level: 3, content: 'Technical Architecture' });
  assert.equal(el.tagName, 'H3');
  assert.equal(el.className, 'block-heading level-3');
  assert.equal(el.textContent, 'Technical Architecture');
});

test('renderHeading: defaults to H2 when level is omitted or invalid', () => {
  const { exports } = createSandbox();
  const el = exports.renderHeading({ type: 'heading', content: 'Default Level' });
  assert.equal(el.tagName, 'H2');
  assert.equal(el.className, 'block-heading level-2');
});

test('renderParagraph: creates paragraph with safe textContent', () => {
  const { exports } = createSandbox();
  const raw = '<script>alert(1)</script>Explaining the trade-offs.';
  const el = exports.renderParagraph({ type: 'paragraph', content: raw });
  assert.equal(el.tagName, 'P');
  assert.equal(el.className, 'block-paragraph');
  assert.equal(el.textContent, raw);
});

test('renderList: renders unordered and ordered lists with items', () => {
  const { exports } = createSandbox();
  const un = exports.renderList({ type: 'list', style: 'unordered', items: ['Factor A', 'Factor B'] });
  assert.equal(un.tagName, 'UL');
  assert.equal(un.className, 'block-list');
  assert.equal(un.children.length, 2);
  assert.equal(un.children[0].textContent, 'Factor A');

  const ord = exports.renderList({ type: 'list', style: 'ordered', items: ['Step 1', 'Step 2'] });
  assert.equal(ord.tagName, 'OL');
  assert.equal(ord.className, 'block-list');
  assert.equal(ord.children[1].textContent, 'Step 2');
});

test('renderCode: creates code wrapper with language tag and pre/code elements', () => {
  const { exports } = createSandbox();
  const el = exports.renderCode({ type: 'code', language: 'python', content: 'def solve(): return 42' });
  assert.equal(el.className, 'block-code-wrapper');
  assert.equal(el.children.length, 2);

  const header = el.children[0];
  const pre = el.children[1];
  assert.equal(header.className, 'block-code-header');
  assert.equal(pre.className, 'block-code');
  assert.equal(pre.children[0].textContent, 'def solve(): return 42');
});

test('renderQuote: creates blockquote with quote text', () => {
  const { exports } = createSandbox();
  const el = exports.renderQuote({ type: 'quote', content: 'Simplicity is prerequisite for reliability.' });
  assert.equal(el.tagName, 'BLOCKQUOTE');
  assert.equal(el.className, 'block-quote');
  assert.equal(el.textContent, 'Simplicity is prerequisite for reliability.');
});

test('renderTable: creates table with thead headers and tbody rows', () => {
  const { exports } = createSandbox();
  const el = exports.renderTable({
    type: 'table',
    headers: ['Pattern', 'Use Case'],
    rows: [['Factory', 'Object creation'], ['Observer', 'Event notification']]
  });
  assert.equal(el.className, 'block-table-wrapper');
  const table = el.children[0];
  assert.equal(table.tagName, 'TABLE');

  const thead = table.children[0];
  const tbody = table.children[1];
  assert.equal(thead.tagName, 'THEAD');
  assert.equal(tbody.tagName, 'TBODY');

  // Verify headers
  const ths = thead.children[0].children;
  assert.equal(ths.length, 2);
  assert.equal(ths[0].textContent, 'Pattern');
  assert.equal(ths[1].textContent, 'Use Case');

  // Verify rows
  assert.equal(tbody.children.length, 2);
  assert.equal(tbody.children[0].children[0].textContent, 'Factory');
  assert.equal(tbody.children[1].children[1].textContent, 'Event notification');
});

test('renderCallout: creates callout with variant, badge, and content', () => {
  const { exports } = createSandbox();
  const el = exports.renderCallout({
    type: 'callout',
    variant: 'warning',
    title: 'Edge Case',
    content: 'Null values may trigger a KeyError.'
  });
  assert.equal(el.className, 'block-callout variant-warning');
  assert.equal(el.children.length, 2);

  const header = el.children[0];
  const body = el.children[1];
  assert.equal(header.children[0].textContent, 'WARNING');
  assert.equal(header.children[1].textContent, 'Edge Case');
  assert.equal(body.textContent, 'Null values may trigger a KeyError.');
});

test('renderDivider: creates horizontal hr element', () => {
  const { exports } = createSandbox();
  const el = exports.renderDivider();
  assert.equal(el.tagName, 'HR');
  assert.equal(el.className, 'block-divider');
});

test('renderNextPrompt: renders action-oriented prompt with copy button', async () => {
  const { exports, sandbox } = createSandbox();
  const el = exports.renderNextPrompt({
    type: 'next_prompt',
    title: 'Suggested Follow-Up',
    prompt: 'How would this solution change under high memory constraints?'
  });
  assert.equal(el.className, 'block-next-prompt');
  assert.equal(el.children.length, 2);

  const header = el.children[0];
  const body = el.children[1];
  assert.equal(header.className, 'block-next-prompt-header');
  assert.equal(header.children[0].textContent, 'Suggested Follow-Up');

  // Test copy action button
  const copyBtn = header.children[1];
  assert.equal(copyBtn.textContent, 'Copy prompt');
  copyBtn.click();
  assert.equal(sandbox.navigator.clipboard.lastWritten, 'How would this solution change under high memory constraints?');

  assert.equal(body.className, 'block-next-prompt-text');
  assert.equal(body.textContent, 'How would this solution change under high memory constraints?');
});

test('renderBlock: unknown block with content gracefully renders as paragraph', () => {
  const { exports } = createSandbox();
  const el = exports.renderBlock({ type: 'future_unknown_gadget', content: 'Fallback content' });
  assert.ok(el);
  assert.equal(el.tagName, 'P');
  assert.equal(el.textContent, 'Fallback content');
});

test('renderBlock: malformed or empty block returns null without throwing', () => {
  const { exports } = createSandbox();
  assert.equal(exports.renderBlock(null), null);
  assert.equal(exports.renderBlock(undefined), null);
  assert.equal(exports.renderBlock('not-an-object'), null);
});

test('exportDocumentToMarkdown: formats full document including next_prompt to clean Markdown', () => {
  const { exports } = createSandbox();
  const doc = {
    title: 'Understanding Response Behavior',
    blocks: [
      { type: 'paragraph', content: 'The model prioritized concise answers.' },
      { type: 'heading', level: 2, content: 'Technical Observations' },
      { type: 'list', style: 'unordered', items: ['Point 1', 'Point 2'] },
      { type: 'code', language: 'python', content: 'print("hello")' },
      { type: 'quote', content: 'A quoted remark.' },
      { type: 'table', headers: ['Key', 'Val'], rows: [['A', '1']] },
      { type: 'callout', variant: 'tip', title: 'Note', content: 'Helpful hint.' },
      { type: 'next_prompt', title: 'Follow-Up', prompt: 'What are the race conditions?' },
      { type: 'divider' }
    ]
  };

  const md = exports.exportDocumentToMarkdown(doc);
  assert.ok(md.includes('# Understanding Response Behavior'));
  assert.ok(md.includes('The model prioritized concise answers.'));
  assert.ok(md.includes('## Technical Observations'));
  assert.ok(md.includes('- Point 1'));
  assert.ok(md.includes('- Point 2'));
  assert.ok(md.includes('```python\nprint("hello")\n```'));
  assert.ok(md.includes('> A quoted remark.'));
  assert.ok(md.includes('| Key | Val |'));
  assert.ok(md.includes('| --- | --- |'));
  assert.ok(md.includes('> [!TIP] Note'));
  assert.ok(md.includes('### Follow-Up'));
  assert.ok(md.includes('> What are the race conditions?'));
  assert.ok(md.includes('---'));
});

test('settings: default style and depth preferences are properly initialized', () => {
  const { exports } = createSandbox();
  assert.equal(exports.settingsState.responseStyle, 'Professional and direct');
  assert.equal(exports.settingsState.analysisDepth, 'Balanced');
  assert.equal(exports.settingsState.customInstructions, '');
});
