// V0.6 Sidebar Space Optimization & Capture Integrity Audit Unit Tests
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..', '..');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'sidepanel', 'app.js'), 'utf8');
const CONFIG_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'shared', 'config.js'), 'utf8');
const CSS_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'sidepanel', 'styles.css'), 'utf8');
const HTML_SRC = fs.readFileSync(path.join(ROOT, 'extension', 'src', 'sidepanel', 'index.html'), 'utf8');

function mockEl(tag = 'div', id = '') {
  const classes = new Set();
  const attributes = {};
  const listeners = {};
  const el = {
    tagName: tag.toUpperCase(),
    id,
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
    attributes,
    children: [],
    listeners,
    style: {},
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
    click() {
      (listeners['click'] || []).forEach((fn) => fn({ stopPropagation: () => {} }));
    },
    keydown(key) {
      (listeners['keydown'] || []).forEach((fn) => {
        let prevented = false;
        fn({ key, preventDefault: () => { prevented = true; } });
      });
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

function createSidepanelAppSandbox(elementsMap = {}) {
  const elements = {
    captureCard: mockEl('section', 'captureCard'),
    captureAccordionToggle: mockEl('div', 'captureAccordionToggle'),
    captureChevron: mockEl('span', 'captureChevron'),
    captureStatusBadge: mockEl('span', 'captureStatusBadge'),
    captureAccordionContent: mockEl('div', 'captureAccordionContent'),
    promptPreview: mockEl('p', 'promptPreview'),
    responsePreview: mockEl('p', 'responsePreview'),
    whyBtn: mockEl('button', 'whyBtn'),
    retryBtn: mockEl('button', 'retryBtn'),
    diagBtn: mockEl('button', 'diagBtn'),
    copyAnalysisBtn: mockEl('button', 'copyAnalysisBtn'),
    statusLine: mockEl('p', 'statusLine'),
    statusDot: mockEl('span', 'statusDot'),
    skeletonCard: mockEl('section', 'skeletonCard'),
    resultCard: mockEl('section', 'resultCard'),
    documentTitle: mockEl('h2', 'documentTitle'),
    documentContainer: mockEl('div', 'documentContainer'),
    errorCard: mockEl('section', 'errorCard'),
    errorText: mockEl('p', 'errorText'),
    modeBadge: mockEl('span', 'modeBadge'),
    autoToggle: mockEl('input', 'autoToggle'),
    settingsCard: mockEl('section', 'settingsCard'),
    settingsToggleBtn: mockEl('button', 'settingsToggleBtn'),
    settingsCloseBtn: mockEl('button', 'settingsCloseBtn'),
    responseStyleSelect: mockEl('select', 'responseStyleSelect'),
    customInstructionsGroup: mockEl('div', 'customInstructionsGroup'),
    customInstructionsInput: mockEl('textarea', 'customInstructionsInput'),
    analysisDepthSelect: mockEl('select', 'analysisDepthSelect'),
    ...elementsMap
  };

  const store = {};
  const sandbox = {
    console: {
      debug: () => {},
      warn: () => {},
      error: () => {}
    },
    document: {
      createElement: (tag) => mockEl(tag),
      getElementById: (id) => elements[id] || mockEl('div', id)
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

  vm.createContext(sandbox);
  vm.runInContext(CONFIG_SRC, sandbox);
  vm.runInContext(APP_SRC, sandbox);

  return { exports: sandbox.module.exports, elements, sandbox };
}

test('HTML: Captured Interaction markup includes accordion toggle, badges, and ARIA attributes', () => {
  assert.ok(HTML_SRC.includes('id="captureAccordionToggle"'), 'toggle ID exists');
  assert.ok(HTML_SRC.includes('aria-expanded="false"'), 'toggle initial aria-expanded is false');
  assert.ok(HTML_SRC.includes('aria-controls="captureAccordionContent"'), 'toggle references content ID');
  assert.ok(HTML_SRC.includes('role="button"'), 'toggle has button role for assistive tech');
  assert.ok(HTML_SRC.includes('tabindex="0"'), 'toggle is keyboard focusable');
  assert.ok(HTML_SRC.includes('id="captureStatusBadge"'), 'status badge exists');
  assert.ok(HTML_SRC.includes('id="captureAccordionContent" hidden'), 'accordion content is hidden by default');
});

test('CSS: .accordion-content is independently scrollable with bounded height and overscroll containment', () => {
  assert.ok(CSS_SRC.includes('.accordion-content {'), 'accordion-content class styled');
  assert.ok(CSS_SRC.includes('max-height: 240px;'), 'bounded maximum height configured');
  assert.ok(CSS_SRC.includes('overflow-y: auto;'), 'vertical scrolling enabled');
  assert.ok(CSS_SRC.includes('overscroll-behavior-y: contain;'), 'scroll chaining contained');
  assert.ok(CSS_SRC.includes('.accordion-header:focus-visible'), 'focus-visible ring styled for keyboard access');
});

test('Accordion: is collapsed by default upon initialization', () => {
  const { exports, elements } = createSidepanelAppSandbox();
  assert.strictEqual(exports.getCaptureExpanded(), false, 'accordion state is collapsed (false)');
  assert.strictEqual(elements.captureAccordionContent.hidden, true, 'accordion content is hidden');
  assert.strictEqual(elements.captureAccordionToggle.getAttribute('aria-expanded'), 'false', 'aria-expanded is false');
  assert.strictEqual(elements.captureChevron.textContent, '\u25BC', 'chevron points down (collapsed)');
});

test('Accordion: clicking header toggles expanded and collapsed states', () => {
  const { exports, elements } = createSidepanelAppSandbox();

  // First click: expand
  elements.captureAccordionToggle.click();
  assert.strictEqual(exports.getCaptureExpanded(), true, 'accordion state is expanded (true)');
  assert.strictEqual(elements.captureAccordionContent.hidden, false, 'accordion content is visible');
  assert.strictEqual(elements.captureAccordionToggle.getAttribute('aria-expanded'), 'true', 'aria-expanded is true');
  assert.strictEqual(elements.captureChevron.textContent, '\u25B2', 'chevron points up (expanded)');

  // Second click: collapse
  elements.captureAccordionToggle.click();
  assert.strictEqual(exports.getCaptureExpanded(), false, 'accordion state is collapsed (false)');
  assert.strictEqual(elements.captureAccordionContent.hidden, true, 'accordion content is hidden');
  assert.strictEqual(elements.captureAccordionToggle.getAttribute('aria-expanded'), 'false', 'aria-expanded is false');
  assert.strictEqual(elements.captureChevron.textContent, '\u25BC', 'chevron points down (collapsed)');
});

test('Accordion: keyboard activation (Enter and Space) toggles state', () => {
  const { exports, elements } = createSidepanelAppSandbox();

  // Enter key
  elements.captureAccordionToggle.keydown('Enter');
  assert.strictEqual(exports.getCaptureExpanded(), true, 'expanded via Enter');
  assert.strictEqual(elements.captureAccordionContent.hidden, false);

  // Space key
  elements.captureAccordionToggle.keydown(' ');
  assert.strictEqual(exports.getCaptureExpanded(), false, 'collapsed via Space');
  assert.strictEqual(elements.captureAccordionContent.hidden, true);
});

test('Audit: displays complete text beyond 600 characters without ellipsis truncation', () => {
  const { exports } = createSidepanelAppSandbox();

  const longText = 'A'.repeat(2500) + ' ' + 'B'.repeat(500);
  assert.ok(longText.length > 600, 'text is significantly longer than 600 chars');

  const formatted = exports.formatCapturedForDisplay(longText, 8000);
  assert.strictEqual(formatted.length, longText.length, 'complete text length preserved');
  assert.strictEqual(formatted.includes('…'), false, 'no ellipsis truncation added');
  assert.strictEqual(formatted.endsWith('…'), false, 'does not terminate with ellipsis');
});

test('Audit: trimForBackend and formatCapturedForDisplay match backend request payload limits', () => {
  const { exports } = createSidepanelAppSandbox();

  // Prompt within 8k limit
  const prompt7k = 'P'.repeat(7000);
  assert.strictEqual(exports.trimForBackend(prompt7k, 8000), prompt7k);
  assert.strictEqual(exports.formatCapturedForDisplay(prompt7k, 8000), prompt7k);

  // Response within 20k limit
  const resp15k = 'R'.repeat(15000);
  assert.strictEqual(exports.trimForBackend(resp15k, 20000), resp15k);
  assert.strictEqual(exports.formatCapturedForDisplay(resp15k, 20000), resp15k);

  // Prompt exceeding 8k limit is trimmed to exactly 8000 characters
  const prompt9k = 'X'.repeat(9000);
  const trimmedP = exports.trimForBackend(prompt9k, 8000);
  assert.strictEqual(trimmedP.length, 8000);
  assert.strictEqual(exports.formatCapturedForDisplay(prompt9k, 8000), trimmedP);

  // Response exceeding 20k limit is trimmed to exactly 20000 characters
  const resp25k = 'Y'.repeat(25000);
  const trimmedR = exports.trimForBackend(resp25k, 20000);
  assert.strictEqual(trimmedR.length, 20000);
  assert.strictEqual(exports.formatCapturedForDisplay(resp25k, 20000), trimmedR);
});

test('Accordion: expansion state is preserved when setCaptureExpanded is manually called', () => {
  const { exports, elements } = createSidepanelAppSandbox();

  // User expands the section
  exports.setCaptureExpanded(true);
  assert.strictEqual(exports.getCaptureExpanded(), true);
  assert.strictEqual(elements.captureAccordionContent.hidden, false);

  // Calling setCaptureExpanded(true) again preserves expanded state
  exports.setCaptureExpanded(true);
  assert.strictEqual(exports.getCaptureExpanded(), true);
  assert.strictEqual(elements.captureAccordionContent.hidden, false);
});
