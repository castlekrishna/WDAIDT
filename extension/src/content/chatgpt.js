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

  const VERSION = '1.0.0';
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

  // Normalizes whitespace while preserving paragraph structure: single and
  // double line breaks survive (paragraphs stay paragraphs); runs of 3+
  // collapse to a paragraph break; trailing spaces per line are trimmed.
  function norm(s) {
    return String(s || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t\f\v]+/g, ' ')
      .replace(/[ \t\f\v]+\n/g, '\n')
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
    if (t && t.trim()) return norm(t);
    // innerText is empty for non-rendered content (display:none nodes,
    // aria-hidden announcers, detached fragments). Only fall back to
    // textContent when the element is actually rendered; otherwise hidden
    // accessibility chrome would leak into the capture.
    if (!isRendered(el)) return '';
    try {
      t = el.textContent || '';
    } catch {
      t = '';
    }
    return norm(t);
  }

  // True when the element participates in layout and is not explicitly
  // hidden. Defaults to true when layout APIs are unavailable (tests,
  // exotic contexts) so genuine messages are never dropped for lack
  // of a measurement API.
  function isRendered(el) {
    try {
      if (el && typeof el.getClientRects === 'function') {
        const rects = el.getClientRects();
        if (rects.length === 0) return false;
        // 1px by 1px or 0px clipping hacks used for screen readers (e.g. dnd-kit)
        if (rects[0] && rects[0].width != null && rects[0].height != null) {
          if (rects[0].width <= 1 && rects[0].height <= 1) return false;
        }
      }
      if (
        typeof window !== 'undefined' &&
        window.getComputedStyle &&
        el &&
        el.nodeType !== 11
      ) {
        const cs = window.getComputedStyle(el);
        if (cs) {
          if (cs.visibility === 'hidden' || cs.display === 'none') {
            return false;
          }
          if (cs.clip && cs.clip.includes('rect(0')) return false;
          if (
            cs.clipPath &&
            (cs.clipPath.includes('inset(100%)') || cs.clipPath.includes('inset(50%)'))
          ) {
            return false;
          }
        }
      }
    } catch {
      return true;
    }
    return true;
  }

  // True for overlay chrome (hover tooltips, toast portals, drag helpers, menus) or
  // fixed overlays. Genuine conversation turns are never overlay chrome.
  function isFixed(el) {
    try {
      if (!el) return false;
      if (
        el.closest &&
        el.closest(
          '[role="tooltip"],[role="dialog"],[role="menu"],[role="alertdialog"],' +
            '[data-radix-portal],[data-floating-ui-portal],[id*="portal"],[class*="portal"]'
        )
      ) {
        return true;
      }
      if (typeof window !== 'undefined' && window.getComputedStyle) {
        const cs = window.getComputedStyle(el);
        if (cs && cs.position === 'fixed') return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function isFeedbackOrDisclaimer(el) {
    try {
      if (!el) return false;
      if (
        el.closest &&
        el.closest(
          '[data-testid*="feedback"],[class*="feedback"],' +
          '[data-testid*="disclaimer"],[class*="disclaimer"],' +
          '[data-testid*="survey"],[class*="survey"]'
        )
      ) {
        return true;
      }
      const text = norm(el.textContent || '');
      // If el has substantial text, it's a message or turn container, not a tiny widget
      if (!text || text.length > 200) return false;
      const lower = text.toLowerCase();
      if (
        lower.includes('chatgpt can make mistakes') ||
        lower.includes('check important info') ||
        lower.includes('consider checking important information') ||
        lower.includes('helpful so far') ||
        lower.includes('was this response helpful') ||
        lower.includes('was this helpful') ||
        lower.includes('give feedback') ||
        lower.includes('provide feedback')
      ) {
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function insideExcluded(el) {
    try {
      if (!el) return false;
      if (isFeedbackOrDisclaimer(el)) return true;
      if (!el.closest) return false;
      return !!el.closest(
        'textarea,[contenteditable="true"],[data-testid*="composer"],form[data-testid*="composer"],' +
          'header,[data-testid*="header"],[data-testid*="app-shell"],nav,aside,footer,[role="dialog"],[role="navigation"],' +
          '[role="menu"],[role="menuitem"],[aria-hidden="true"],' +
          '[role="alert"],[role="log"],[role="tooltip"],' +
          '[role="marquee"],[role="timer"],[aria-live="assertive"],' +
          '[id*="Dnd"],[id*="dnd"],[class*="dnd"],' +
          '#sidebar,[id*="sidebar"],[class*="sidebar"],[data-testid*="sidebar"],' +
          '[aria-label*="Chat history"],[aria-label*="chat history"],' +
          '.sr-only,[class*="sr-only"],[class*="visually-hidden"],' +
          '[hidden],[inert]'
      );
    } catch {
      return false;
    }
  }

  // Live-region guard for the weak-signal structural fallback: polite
  // announcements (streaming chatter, drag/drop instructions, toasts) must
  // never become conversation turns. Attribute-strong strategies above keep
  // working so genuine streaming replies are unaffected.
  function insideLive(el) {
    try {
      if (!el || !el.closest) return false;
      return !!el.closest(
        '[aria-live],[role="status"],[role="alert"],[role="log"]'
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

  function chatScope() {
    try {
      if (typeof document !== 'undefined') {
        const mains = Array.from(document.querySelectorAll('main'));
        const visibleMains = mains.filter(
          (m) => isRendered(m) && !insideExcluded(m)
        );
        if (visibleMains.length > 0) {
          return visibleMains[visibleMains.length - 1];
        }
        if (mains.length > 0) {
          return mains[mains.length - 1];
        }
      }
    } catch {
      /* ignore */
    }
    return typeof document !== 'undefined' ? document : null;
  }

  // Query `selector` across light DOM + open shadow roots, DOM-ordered.
  function deepQuery(selector, root) {
    const out = [];
    const start = root || chatScope();
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
  function findRoleNodes(root) {
    const els = deepQuery('[data-message-author-role],[data-author-role]', root);
    const out = [];
    for (const el of els) {
      if (insideExcluded(el) || !isRendered(el)) continue;
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
  function findMessageIdNodes(root) {
    const els = deepQuery('[data-message-id]', root);
    const out = [];
    let auto = 0;
    for (const el of els) {
      if (insideExcluded(el) || isFixed(el) || !isRendered(el)) continue;
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
      if (insideExcluded(el) || isFixed(el) || !isRendered(el)) continue;
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
  function findTurnNodes(root) {
    const els = deepQuery(
      '[data-testid^="conversation-turn"],[data-testid*="conversation-turn"]',
      root
    );
    const out = pairTurnWrappers(els);
    debug(`conversation-turns: ${out.length} nodes`);
    return out;
  }

  // Strategy 4: article elements, one turn each.
  function findArticleNodes(root) {
    const els = deepQuery('main article,article', root);
    const out = pairTurnWrappers(els);
    debug(`articles: ${out.length} nodes`);
    return out;
  }

  // Strategy 5: modern ChatGPT turns — markdown/prose AI containers + whitespace-pre-wrap user bubbles
  function findModernNodes(root) {
    const rawEls = deepQuery(
      '[data-message-author-role="user"], [data-message-author-role="assistant"], ' +
        '[class*="agent-turn"], [class*="user-turn"], ' +
        '.markdown, .prose, [class*="markdown"], [class*="prose"], ' +
        'div.whitespace-pre-wrap, .whitespace-pre-wrap, [class*="whitespace-pre-wrap"]',
      root
    );
    const validEls = rawEls.filter((el) => !insideExcluded(el) && !isFixed(el) && isRendered(el));

    // Identify AI response containers: elements matching .markdown, .prose, agent-turn, or assistant role
    const asstContainers = validEls.filter((el) => {
      const isAI =
        readRole(el) === 'assistant' ||
        (el.className &&
          typeof el.className === 'string' &&
          (el.className.includes('markdown') || el.className.includes('prose') || el.className.includes('agent-turn'))) ||
        classifyByAffordance(el) === 'assistant';
      if (!isAI) return false;
      // Do not keep if an ancestor element is already an AI container (keep outermost response container)
      if (
        el.parentElement &&
        el.parentElement.closest &&
        el.parentElement.closest('.markdown, .prose, [class*="markdown"], [class*="prose"], [class*="agent-turn"]')
      ) {
        return false;
      }
      return true;
    });

    // Identify User prompt containers: whitespace-pre-wrap or user-turn that is NOT inside an AI container
    const userContainers = validEls.filter((el) => {
      // Internal code blocks, callouts, or quotes inside an AI container are NEVER user turns
      if (
        el.closest &&
        el.closest('.markdown, .prose, [class*="markdown"], [class*="prose"], [class*="agent-turn"]')
      ) {
        return false;
      }
      const isUser =
        readRole(el) === 'user' ||
        (el.className &&
          typeof el.className === 'string' &&
          (el.className.includes('user-turn') || el.className.includes('whitespace-pre-wrap'))) ||
        classifyByAffordance(el) === 'user';
      if (!isUser) return false;
      // If an inner whitespace-pre-wrap exists inside this element, keep the inner leaf
      if (
        validEls.some(
          (other) =>
            other !== el &&
            other.className &&
            typeof other.className === 'string' &&
            other.className.includes('whitespace-pre-wrap') &&
            containsNode(el, other)
        )
      ) {
        return false;
      }
      return true;
    });

    const allTurns = [
      ...asstContainers.map((el) => ({ el, role: 'assistant' })),
      ...userContainers.map((el) => ({ el, role: 'user' })),
    ];
    try {
      allTurns.sort((a, b) => {
        if (a.el === b.el) return 0;
        const pos = a.el.compareDocumentPosition(b.el);
        return pos & 2 ? 1 : -1;
      });
    } catch {
      /* keep order */
    }

    const out = [];
    const seenEls = new Set();
    for (const turn of allTurns) {
      if (seenEls.has(turn.el)) continue;
      seenEls.add(turn.el);
      const text = visibleText(turn.el);
      if (!text || !text.trim()) continue;
      out.push({ role: turn.role, text });
    }
    debug(`modern-turns: ${out.length} nodes`);
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

  // Strategy 6: structural last resort — substantial text blocks inside <main>
  // Sidebar/history chrome is excluded by closest() guards plus the link-item guard,
  // and a substantial block is required so chrome text alone never yields a fake pair.
  function findContentBlocks(root) {
    let scope = null;
    try {
      if (typeof document !== 'undefined') {
        scope =
          (root && root !== document ? root : null) ||
          document.querySelector('main') ||
          document.body;
      }
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
        if (
          isBlockTag(node) &&
          !insideExcluded(node) &&
          !insideLive(node) &&
          !isFixed(node)
        ) {
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
    // Keep leaf-most blocks, BUT preserve markdown containers intact (do not fragment into <p>s).
    const leaf = found.filter((b) => {
      const isMd =
        (b.el.className && typeof b.el.className === 'string' && b.el.className.includes('markdown')) ||
        (b.el.matches && b.el.matches('.markdown, [class*="markdown"]'));
      if (isMd) return true;
      if (b.el.closest && b.el.closest('.markdown, [class*="markdown"]')) return false;
      return !found.some(
        (c) => c !== b && c.text.length > 20 && containsNode(b.el, c.el)
      );
    });
    // Require at least one substantial (assistant-length) block, otherwise
    // this is chrome text, not a conversation.
    if (!leaf.some((b) => b.text.length >= 60)) {
      debug('content-blocks: no substantial block, discarded');
      return [];
    }
    let auto = 0;
    const out = [];
    for (const b of leaf) {
      let role = readRole(b.el);
      if (!role) {
        if (
          (b.el.className &&
            typeof b.el.className === 'string' &&
            (b.el.className.includes('markdown') ||
              b.el.className.includes('prose'))) ||
          classifyByAffordance(b.el) === 'assistant'
        ) {
          role = 'assistant';
        } else {
          role = roleOf(b.el, auto % 2 === 0 ? 'user' : 'assistant');
        }
      }
      if (role !== 'user' && role !== 'assistant') continue;
      auto += 1;
      out.push({ role, text: b.text });
    }
    // Weakest signal of all: hook-less text blocks may be anything (toasts,
    // tooltips, announcements). Only accept a COMPLETE ordered pair — a lone
    // block here is chrome until proven otherwise, never a "prompt".
    if (out.length) {
      const check = pairLatest(out);
      if (!check.paired || !check.prompt || !check.response) {
        debug('content-blocks: no complete pair, discarded');
        return [];
      }
    }
    debug(`content-blocks: ${out.length} nodes`);
    return out;
  }

  function pairExchanges(nodes) {
    const users = nodes.filter((n) => n.role === 'user');
    const assistants = nodes.filter((n) => n.role === 'assistant');
    const base = { userCount: users.length, assistantCount: assistants.length, history: [] };
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

    // Identify user turn indices in DOM order
    const userIndices = [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].role === 'user') {
        userIndices.push(i);
      }
    }

    // Partition nodes into complete user-assistant exchanges
    const completedExchanges = [];
    for (let k = 0; k < userIndices.length; k++) {
      const uIdx = userIndices[k];
      const nextUIdx = (k + 1 < userIndices.length) ? userIndices[k + 1] : nodes.length;
      const turnAssts = [];
      for (let j = uIdx + 1; j < nextUIdx; j++) {
        if (nodes[j].role === 'assistant') {
          turnAssts.push(nodes[j]);
        }
      }
      if (turnAssts.length > 0) {
        // Last assistant turn handles regenerated responses where multiple drafts exist
        const asstTurn = turnAssts[turnAssts.length - 1];
        completedExchanges.push({
          prompt: nodes[uIdx].text,
          response: asstTurn.text
        });
      }
    }

    const li = nodes.lastIndexOf(lastUser);
    const lj = nodes.lastIndexOf(lastAsst);

    if (lj > li) {
      // The newest user message has a reply after it -> completed current exchange
      // Preceding history is all completed exchanges prior to the latest exchange
      const history = completedExchanges.length > 1
        ? completedExchanges.slice(0, -1)
        : [];
      return {
        prompt: lastUser.text,
        response: lastAsst.text,
        paired: true,
        userCount: users.length,
        assistantCount: assistants.length,
        history,
      };
    }

    // The newest user message has no reply after it yet (pending / streaming)
    // History contains all completed exchanges prior to this user message
    return {
      prompt: lastUser.text,
      response: '',
      paired: false,
      userCount: users.length,
      assistantCount: assistants.length,
      history: completedExchanges,
    };
  }

  function pairLatest(nodes) {
    return pairExchanges(nodes);
  }

  // Small structural summary so failures are diagnosable from the sidebar.
  function fingerprint() {
    const docRoot = typeof document !== 'undefined' ? document : null;
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
      fp.articles = deepQuery('article', docRoot).length;
      fp.mains = (typeof document !== 'undefined' && document.querySelectorAll) ? document.querySelectorAll('main').length : 0;
      fp.roleAttr = deepQuery('[data-message-author-role]', docRoot).length;
      fp.messageId = deepQuery('[data-message-id]', docRoot).length;
      const withTestid = deepQuery('[data-testid]', docRoot);
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
      const all = deepQuery('*', docRoot);
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

  const EMPTY = { prompt: '', response: '', paired: false, userCount: 0, assistantCount: 0, history: [] };

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

    const root = chatScope();
    const attempts = [
      ['role-attributes', () => findRoleNodes(root)],
      ['message-id', () => findMessageIdNodes(root)],
      ['conversation-turns', () => findTurnNodes(root)],
      ['articles', () => findArticleNodes(root)],
      ['modern-turns', () => findModernNodes(root)],
      ['content-blocks', () => findContentBlocks(root)],
    ];
    let strategy = 'role-attributes(empty)';
    let r = { ...EMPTY };
    let bestPartial = null;
    let bestPartialStrategy = '';

    for (const [name, fn] of attempts) {
      let nodes = [];
      try {
        nodes = fn();
      } catch {
        nodes = [];
      }
      if (!nodes.length) continue;
      const candidate = pairLatest(nodes);
      if (candidate.paired && candidate.prompt && candidate.response) {
        // Complete paired turn wins immediately.
        strategy = name;
        r = candidate;
        break;
      }
      if (candidate.prompt || candidate.response) {
        if (!bestPartial || (!bestPartial.response && candidate.response) || (!bestPartial.prompt && candidate.prompt)) {
          bestPartial = candidate;
          bestPartialStrategy = name;
        }
      }
    }

    // If the scoped main didn't yield a complete pair, retry across the document body
    // in case ChatGPT rendered the thread outside main or in an alternate container.
    if (!r.paired && root && typeof document !== 'undefined' && root !== document) {
      const docRoot = document;
      for (const [name, fn] of [
        ['modern-turns', () => findModernNodes(docRoot)],
        ['conversation-turns', () => findTurnNodes(docRoot)],
        ['role-attributes', () => findRoleNodes(docRoot)],
        ['content-blocks', () => findContentBlocks(docRoot)],
      ]) {
        let nodes = [];
        try { nodes = fn(); } catch { nodes = []; }
        if (!nodes.length) continue;
        const candidate = pairLatest(nodes);
        if (candidate.paired && candidate.prompt && candidate.response) {
          strategy = name;
          r = candidate;
          break;
        }
        if (candidate.prompt || candidate.response) {
          if (!bestPartial || (!bestPartial.response && candidate.response)) {
            bestPartial = candidate;
            bestPartialStrategy = name;
          }
        }
      }
    }

    if (!r.paired && bestPartial) {
      r = bestPartial;
      strategy = bestPartialStrategy;
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
      history: r.history || [],
    };
  }

  function handleMessage(message, sendResponse) {
    const types = sharedTypes();
    if (!message || typeof message.type !== 'string') return false;

    if (message.type === TYPE_PING || message.type === types.PING) {
      sendResponse({ ok: true, onChatGPT: isChatGPTPage(), version: VERSION });
      return true;
    }

    if (
      message.type === types.AUTO_ANALYZE_ON ||
      message.type === 'WDAIDT_AUTO_ANALYZE_ON'
    ) {
      autoSeq += 1;
      autoEnabled = true;
      lastNotifiedHash = ''; // re-evaluate the current thread on enable
      autoArm();
      autoSchedule();
      sendResponse({ ok: true, auto: true });
      return true;
    }

    if (
      message.type === types.AUTO_ANALYZE_OFF ||
      message.type === 'WDAIDT_AUTO_ANALYZE_OFF'
    ) {
      autoSeq += 1;
      autoEnabled = false;
      autoDisarm();
      sendResponse({ ok: true, auto: false });
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

  // ── Auto Analyze (V0.3): stream-completion trigger + debounce ──────────
  // Watches the thread for a newly settled exchange. Streaming produces
  // continuous DOM mutations, so a quiet period of AUTO_DEBOUNCE_MS after
  // the last mutation means the reply finished. Fires only for complete,
  // previously unreported pairs while the toggle is ON. The sidebar (if
  // open) analyzes the payload; nothing is sent anywhere else.
  const AUTO_DEBOUNCE_MS =
    (typeof globalThis !== 'undefined' &&
      globalThis.__WDAIDT_AUTO_DEBOUNCE_MS) ||
    2000;

  let autoEnabled = false;
  let autoTimer = null;
  let autoObserver = null;
  let lastNotifiedHash = '';
  // Generation counter: an async storage read that resolves after a newer
  // explicit ON/OFF (or another refresh) must not clobber the newer state.
  let autoSeq = 0;

  function snapshotHash(r) {
    const tail =
      String(r.prompt).slice(-120) + '\n' + String(r.response).slice(-120);
    let h = 5381;
    for (let i = 0; i < tail.length; i++) {
      h = ((h << 5) + h + tail.charCodeAt(i)) | 0;
    }
    return `${r.prompt.length}:${r.response.length}:${h}`;
  }

  function autoCheck() {
    autoTimer = null;
    if (!autoEnabled) return;
    try {
      if (typeof document !== 'undefined' && document.hidden) return;
    } catch {
      /* proceed when visibility is unknown */
    }
    let r;
    try {
      r = getLatestInteraction();
    } catch {
      return;
    }
    if (!r || !r.onChatGPT || !r.prompt || !r.response || !r.paired) return;
    const h = snapshotHash(r);
    if (h === lastNotifiedHash) return;
    lastNotifiedHash = h;
    const types = sharedTypes();
    const type = types.AUTO_ANALYZE_TRIGGER || 'WDAIDT_AUTO_ANALYZE_TRIGGER';
    try {
      if (typeof chrome === 'undefined' || !chrome.runtime) return;
      const p = chrome.runtime.sendMessage({
        type,
        prompt: r.prompt,
        response: r.response,
        url: r.url,
        history: r.history || [],
      });
      if (p && p.catch) p.catch(() => {});
    } catch {
      /* panel closed / no listener — non-fatal */
    }
    debug(`auto: notified ${h}`);
  }

  function autoSchedule() {
    if (!autoEnabled) return;
    try {
      if (autoTimer) clearTimeout(autoTimer);
      autoTimer = setTimeout(autoCheck, AUTO_DEBOUNCE_MS);
    } catch {
      /* timers unavailable */
    }
  }

  function autoArm() {
    if (autoObserver) return;
    try {
      if (typeof MutationObserver === 'undefined') return;
      const target =
        (typeof document !== 'undefined' &&
          (document.documentElement || document.body)) ||
        null;
      if (!target) return;
      autoObserver = new MutationObserver(() => autoSchedule());
      autoObserver.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
      });
      debug('auto: watcher armed');
    } catch {
      autoObserver = null;
    }
  }

  function autoDisarm() {
    try {
      if (autoTimer) clearTimeout(autoTimer);
    } catch {
      /* ignore */
    }
    autoTimer = null;
    try {
      if (autoObserver) autoObserver.disconnect();
    } catch {
      /* ignore */
    }
    autoObserver = null;
  }

  async function autoRefresh() {
    const mine = ++autoSeq;
    let on = false;
    try {
      if (
        typeof chrome !== 'undefined' &&
        chrome.storage &&
        chrome.storage.local
      ) {
        const s = await chrome.storage.local.get('wdaidt_auto_analyze');
        on = !!(s && s.wdaidt_auto_analyze === true);
      }
    } catch {
      on = false;
    }
    if (mine !== autoSeq) return; // superseded by newer ON/OFF/refresh
    autoEnabled = on;
    if (on) {
      autoArm();
      autoSchedule();
    } else {
      autoDisarm();
    }
  }

  try {
    if (
      typeof chrome !== 'undefined' &&
      chrome.storage &&
      chrome.storage.onChanged &&
      chrome.storage.onChanged.addListener
    ) {
      chrome.storage.onChanged.addListener(() => {
        autoRefresh();
      });
    }
  } catch {
    /* non-fatal */
  }
  autoRefresh();

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
      pairExchanges,
    });
  } catch {
    // non-fatal
  }
})();
