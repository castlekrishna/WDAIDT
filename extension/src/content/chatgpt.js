/* WDAIDT content script — ChatGPT prompt/response capture ONLY.
 * No analysis logic here. No backend calls here.
 *
 * Strategies, in order (first one yielding text wins):
 *  1. role-attributes  — `[data-message-author-role]` / `[data-author-role]`
 *     in DOM order, leaf-most only, composer/chrome excluded.
 *  2. message-id       — `[data-message-id]` elements classified by inner
 *     role markup, then by action affordances (Copy/Edit buttons), else order.
 *  3. conversation-turns — `[data-testid*="conversation-turn"]` wrappers.
 *  4. articles — `main article` / `article`, one turn each.
 *  5. content-blocks — structural last resort: substantial text blocks inside
 *     `main`, classified by role markup, then affordances, else alternation.
 *
 * All queries pierce open shadow roots. Pairing: the latest user message plus
 * the latest assistant message AFTER it. A newest user message with no reply
 * yet returns prompt + '' + paired:false (honest partial, no stale pair).
 * Every response carries {strategy,userCount,assistantCount,paired} plus a
 * small `fingerprint` of the page so the sidebar can explain failures.
 */

(() => {
  'use strict';

  const VERSION = '0.3.0';
  const TYPE_GET_LATEST = 'WDAIDT_GET_LATEST';
  const TYPE_PING = 'WDAIDT_PING';

  function sharedTypes() {
    try {
      return (typeof globalThis !== 'undefined' && globalThis.WDAIDT_MESSAGES) || {};
    } catch {
      return {};
    }
  }

  const debugLog = [];
  function debug(msg) {
    try {
      debugLog.push(String(msg));
      if (debugLog.length > 100) debugLog.shift();
      if (typeof window !== 'undefined') window.__WDAIDT_DEBUG__ = debugLog.slice();
    } catch {
      /* non-fatal */
    }
  }

  function isChatGPTPage() {
    try {
      const host = window.location.hostname || '';
      return host.includes('chatgpt.com') || host.includes('chat.openai.com');
    } catch {
      return false;
    }
  }

  function norm(s) {
    return String(s || '')
      .replace(/\r/g, '')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/ +\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function visibleText(el) {
    if (!el) return '';
    let t = '';
    try {
      t = el.innerText || '';
    } catch {
      t = '';
    }
    if (!t || !t.trim()) {
      try {
        t = el.textContent || '';
      } catch {
        t = '';
      }
    }
    return norm(t);
  }

  function insideExcluded(el) {
    try {
      if (!el || !el.closest) return false;
      return !!el.closest(
        'form,textarea,a,[contenteditable="true"],[data-testid*="composer"],header,nav,aside,footer,[role="dialog"],[role="navigation"]'
      );
    } catch {
      return false;
    }
  }

  function readRole(el) {
    try {
      const attrs = ['data-message-author-role', 'data-author-role', 'data-role'];
      for (const a of attrs) {
        const v = el.getAttribute ? el.getAttribute(a) : null;
        if (v == null) continue;
        const r = String(v).trim().toLowerCase();
        if (r === 'user' || r === 'human') return 'user';
        if (r === 'assistant' || r === 'ai' || r === 'model') return 'assistant';
        if (r === 'system' || r === 'tool') return r;
      }
    } catch {
      /* ignore */
    }
    return '';
  }

  // Semantic classification via message action affordances, which survive
  // class-name redesigns: assistant turns offer Copy/Retry/rating actions,
  // user turns offer Edit.
  function classifyByAffordance(el) {
    try {
      const btns = el.querySelectorAll ? el.querySelectorAll('button') : [];
      let userScore = 0;
      let asstScore = 0;
      for (const b of btns) {
        let label = '';
        try {
          label =
            ((b.getAttribute && b.getAttribute('aria-label')) || '') +
            ' ' +
            (b.textContent || '');
        } catch {
          label = '';
        }
        label = String(label).toLowerCase();
        if (
          label.includes('copy') ||
          label.includes('retry') ||
          label.includes('good response') ||
          label.includes('bad response') ||
          label.includes('read aloud') ||
          (label.includes('like') && !label.includes('dislike'))
        ) {
          asstScore += 1;
        }
        if (/\bedit\b/.test(label)) userScore += 1;
      }
      if (asstScore > userScore) return 'assistant';
      if (userScore > asstScore) return 'user';
    } catch {
      /* ignore */
    }
    return '';
  }

  function roleOf(el, fallbackRole) {
    const direct = readRole(el);
    if (direct === 'user' || direct === 'assistant') return direct;
    try {
      const inner =
        el.querySelector &&
        el.querySelector('[data-message-author-role],[data-author-role]');
      if (inner) {
        const r = readRole(inner);
        if (r === 'user' || r === 'assistant') return r;
      }
    } catch {
      /* ignore */
    }
    const aff = classifyByAffordance(el);
    if (aff === 'user' || aff === 'assistant') return aff;
    return fallbackRole;
  }

  // Query `selector` across light DOM + open shadow roots, DOM-ordered.
  function deepQuery(selector, root) {
    const out = [];
    const start = root || (typeof document !== 'undefined' ? document : null);
    if (!start) return out;
    try {
      const found = start.querySelectorAll(selector);
      for (const el of found) out.push(el);
    } catch {
      /* invalid selector for this root */
    }
    try {
      const all = start.querySelectorAll('*');
      for (const el of all) {
        if (el.shadowRoot) {
          const inner = deepQuery(selector, el.shadowRoot);
          for (const m of inner) out.push(m);
        }
      }
    } catch {
      /* traversal unavailable */
    }
    try {
      out.sort((a, b) => {
        if (a === b) return 0;
        const pos = a.compareDocumentPosition(b);
        return pos & 2 ? 1 : -1;
      });
    } catch {
      /* keep collection order */
    }
    return Array.from(new Set(out));
  }

  function hasInnerRole(el) {
    try {
      if (!el || !el.querySelector) return false;
      return !!el.querySelector(
        ':scope [data-message-author-role],:scope [data-author-role]'
      );
    } catch {
      return false;
    }
  }

  // Strategy 1: explicit role attributes, leaf-most containers only.
  function findRoleNodes() {
    const els = deepQuery('[data-message-author-role],[data-author-role]');
    const out = [];
    for (const el of els) {
      if (insideExcluded(el)) continue;
      const role = readRole(el);
      if (role !== 'user' && role !== 'assistant') continue;
      if (hasInnerRole(el)) continue; // avoid parent/child duplicates
      const text = visibleText(el);
      if (!text) continue;
      out.push({ role, text });
    }
    debug(`role-attributes: ${out.length} nodes`);
    return out;
  }

  // Strategy 2: message-id elements (role often lives on a child or in
  // affordances when the top-level role attribute is gone).
  function findMessageIdNodes() {
    const els = deepQuery('[data-message-id]');
    const out = [];
    let auto = 0;
    for (const el of els) {
      if (insideExcluded(el)) continue;
      if (hasInnerRole(el) && readRole(el) === '') {
        // container wrapping inner role nodes already covered by strategy 1
        continue;
      }
      const text = visibleText(el);
      if (!text || text.length < 2) continue;
      const role = roleOf(el, auto % 2 === 0 ? 'user' : 'assistant');
      if (role !== 'user' && role !== 'assistant') continue;
      auto += 1;
      out.push({ role, text });
    }
    debug(`message-id: ${out.length} nodes`);
    return out;
  }

  function pairTurnWrappers(els) {
    const out = [];
    let auto = 0;
    for (const el of els) {
      if (insideExcluded(el)) continue;
      const text = visibleText(el);
      if (!text || text.length < 2) continue;
      const role = roleOf(el, auto % 2 === 0 ? 'user' : 'assistant');
      if (role !== 'user' && role !== 'assistant') continue;
      auto += 1;
      out.push({ role, text });
    }
    return out;
  }

  // Strategy 3: conversation-turn wrappers.
  function findTurnNodes() {
    const els = deepQuery(
      '[data-testid^="conversation-turn"],[data-testid*="conversation-turn"]'
    );
    const out = pairTurnWrappers(els);
    debug(`conversation-turns: ${out.length} nodes`);
    return out;
  }

  // Strategy 4: article elements, one turn each.
  function findArticleNodes() {
    const els = deepQuery('main article,article');
    const out = pairTurnWrappers(els);
    debug(`articles: ${out.length} nodes`);
    return out;
  }

  function isBlockTag(el) {
    try {
      return /^(P|LI|H1|H2|H3|H4|H5|H6|SECTION|DIV|BLOCKQUOTE)$/.test(
        el.tagName || ''
      );
    } catch {
      return false;
    }
  }

  function containsNode(parent, child) {
    try {
      if (parent.contains) return parent.contains(child);
    } catch {
      /* fall through to parent walk */
    }
    try {
      let n = child && child.parent;
      while (n) {
        if (n === parent) return true;
        n = n.parent;
      }
    } catch {
      /* ignore */
    }
    return false;
  }

  // Strategy 5: structural last resort — substantial text blocks under body
  // (not just `main`: custom renderers can host the thread in a shadow tree
  // elsewhere). Sidebar/history chrome is excluded by closest() guards plus
  // the link-item guard, and a substantial block is required so chrome text
  // alone never yields a fake pair.
  function findContentBlocks() {
    let scope = null;
    try {
      scope = document.body || document.querySelector('main');
    } catch {
      scope = null;
    }
    if (!scope) return [];
    const found = [];
    const walk = (node) => {
      let kids = [];
      try {
        kids = Array.from(node.children || []);
      } catch {
        kids = [];
      }
      try {
        if (node.shadowRoot && node.shadowRoot.children) {
          kids = kids.concat(Array.from(node.shadowRoot.children));
        }
      } catch {
        /* ignore */
      }
      try {
        if (isBlockTag(node) && !insideExcluded(node)) {
          const text = visibleText(node);
          if (text && text.length >= 24) found.push({ el: node, text });
        }
      } catch {
        /* ignore */
      }
      for (const k of kids) walk(k);
    };
    try {
      walk(scope);
    } catch {
      return [];
    }
    // Keep leaf-most blocks only (drop containers duplicating a descendant).
    const leaf = found.filter(
      (b) =>
        !found.some(
          (c) => c !== b && c.text.length > 20 && containsNode(b.el, c.el)
        )
    );
    // Require at least one substantial (assistant-length) block, otherwise
    // this is chrome text, not a conversation.
    if (!leaf.some((b) => b.text.length >= 60)) {
      debug('content-blocks: no substantial block, discarded');
      return [];
    }
    let auto = 0;
    const out = [];
    for (const b of leaf) {
      const role = roleOf(b.el, auto % 2 === 0 ? 'user' : 'assistant');
      if (role !== 'user' && role !== 'assistant') continue;
      auto += 1;
      out.push({ role, text: b.text });
    }
    debug(`content-blocks: ${out.length} nodes`);
    return out;
  }

  function pairLatest(nodes) {
    const users = nodes.filter((n) => n.role === 'user');
    const assistants = nodes.filter((n) => n.role === 'assistant');
    const base = { userCount: users.length, assistantCount: assistants.length };
    if (!users.length && !assistants.length) {
      return { prompt: '', response: '', paired: false, ...base };
    }
    const lastUser = users.length ? users[users.length - 1] : null;
    const lastAsst = assistants.length ? assistants[assistants.length - 1] : null;
    if (lastUser && !lastAsst) {
      return { prompt: lastUser.text, response: '', paired: false, ...base };
    }
    if (!lastUser && lastAsst) {
      return { prompt: '', response: lastAsst.text, paired: false, ...base };
    }
    const li = nodes.lastIndexOf(lastUser);
    const lj = nodes.lastIndexOf(lastAsst);
    if (lj > li) {
      return {
        prompt: lastUser.text,
        response: lastAsst.text,
        paired: true,
        ...base,
      };
    }
    // The newest user message has no reply after it yet (just sent or the
    // reply is still streaming). Report honestly instead of a stale pair.
    return { prompt: lastUser.text, response: '', paired: false, ...base };
  }

  // Small structural summary so failures are diagnosable from the sidebar.
  function fingerprint() {
    const fp = {
      articles: 0,
      mains: 0,
      shadowRoots: 0,
      shadowHosts: [],
      roleAttr: 0,
      messageId: 0,
      turnTestids: 0,
      testids: [],
    };
    try {
      fp.articles = deepQuery('article').length;
      fp.mains = deepQuery('main').length;
      fp.roleAttr = deepQuery('[data-message-author-role]').length;
      fp.messageId = deepQuery('[data-message-id]').length;
      const withTestid = deepQuery('[data-testid]');
      const seen = {};
      for (const el of withTestid) {
        let v = '';
        try {
          v = el.getAttribute('data-testid') || '';
        } catch {
          v = '';
        }
        if (!v) continue;
        if (v.includes('conversation-turn')) fp.turnTestids += 1;
        if (!seen[v] && fp.testids.length < 25) {
          seen[v] = 1;
          fp.testids.push(v);
        }
      }
      const all = deepQuery('*');
      fp.elements = all.length;
      let s = 0;
      for (const el of all) {
        if (!el.shadowRoot) continue;
        s += 1;
        if (fp.shadowHosts.length >= 5) continue;
        const info = { tag: '', childElements: 0, textLen: 0, testids: [] };
        try {
          info.tag = String(el.tagName || '').toLowerCase();
          const sub = deepQuery('*', el.shadowRoot);
          info.childElements = sub.length;
          const seen = {};
          for (const m of sub) {
            let v = '';
            try {
              v = m.getAttribute('data-testid') || '';
            } catch {
              v = '';
            }
            if (v && !seen[v] && info.testids.length < 10) {
              seen[v] = 1;
              info.testids.push(v);
            }
          }
          try {
            info.textLen = norm(el.shadowRoot.textContent || '').length;
          } catch {
            info.textLen = 0;
          }
        } catch {
          /* best effort */
        }
        fp.shadowHosts.push(info);
      }
      fp.shadowRoots = s;
    } catch {
      /* best effort */
    }
    return fp;
  }

  function currentUrl() {
    try {
      return window.location.href;
    } catch {
      return '';
    }
  }

  const EMPTY = { prompt: '', response: '', paired: false, userCount: 0, assistantCount: 0 };

  function getLatestInteraction() {
    const url = currentUrl();
    if (!isChatGPTPage()) {
      return {
        ...EMPTY,
        onChatGPT: false,
        url,
        strategy: 'not-chatgpt',
        fingerprint: fingerprint(),
      };
    }

    const attempts = [
      ['role-attributes', findRoleNodes],
      ['message-id', findMessageIdNodes],
      ['conversation-turns', findTurnNodes],
      ['articles', findArticleNodes],
      ['content-blocks', findContentBlocks],
    ];
    let strategy = 'role-attributes(empty)';
    let r = { ...EMPTY };
    for (const [name, fn] of attempts) {
      let nodes = [];
      try {
        nodes = fn();
      } catch {
        nodes = [];
      }
      if (!nodes.length) continue;
      strategy = name;
      r = pairLatest(nodes);
      if (r.prompt || r.response) break;
    }

    debug(
      `getLatest: strategy=${strategy} users=${r.userCount} assistants=${r.assistantCount} paired=${r.paired} promptLen=${r.prompt.length} responseLen=${r.response.length}`
    );
    return {
      prompt: r.prompt,
      response: r.response,
      onChatGPT: true,
      url,
      strategy,
      userCount: r.userCount,
      assistantCount: r.assistantCount,
      paired: r.paired,
      fingerprint: fingerprint(),
    };
  }

  function handleMessage(message, sendResponse) {
    const types = sharedTypes();
    if (!message || typeof message.type !== 'string') return false;

    if (message.type === TYPE_PING || message.type === types.PING) {
      sendResponse({ ok: true, onChatGPT: isChatGPTPage(), version: VERSION });
      return true;
    }

    if (message.type === types.GET_LATEST || message.type === TYPE_GET_LATEST) {
      try {
        sendResponse({ ok: true, ...getLatestInteraction() });
      } catch (err) {
        sendResponse({
          ok: false,
          prompt: '',
          response: '',
          onChatGPT: isChatGPTPage(),
          error: String((err && err.message) || err),
        });
      }
      return true;
    }
    return false;
  }

  try {
    if (
      typeof chrome !== 'undefined' &&
      chrome.runtime &&
      chrome.runtime.onMessage &&
      chrome.runtime.onMessage.addListener
    ) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (handleMessage(message, sendResponse)) return true;
        return undefined;
      });
    }
  } catch {
    /* non-fatal: page context without chrome APIs (tests) */
  }

  // Debug hook: run `window.__WDAIDT__.getLatest()` in DevTools on a
  // ChatGPT tab; inspect `window.__WDAIDT_DEBUG__` for strategy traces.
  try {
    window.__WDAIDT__ = Object.freeze({
      version: VERSION,
      isChatGPTPage,
      getLatest: getLatestInteraction,
    });
  } catch {
    // non-fatal
  }
})();
