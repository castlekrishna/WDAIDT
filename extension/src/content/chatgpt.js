/* Day 1 (V0.1) content script — ChatGPT prompt/response capture ONLY.
 * No analysis logic here. No backend calls here.
 *
 * Responsibilities:
 *  - detect whether we are on a ChatGPT conversation page
 *  - read the latest user prompt + latest assistant response from the DOM
 *  - answer GET_LATEST / PING messages from the side panel
 */

(() => {
  'use strict';

  const MSG = () =>
    (typeof globalThis !== 'undefined' && globalThis.WDAIDT_MESSAGES) || {};

  function isChatGPTPage() {
    const host = window.location.hostname || '';
    return host.includes('chatgpt.com') || host.includes('chat.openai.com');
  }

  function cleanText(el) {
    if (!el) return '';
    // innerText respects visibility; fall back to textContent for hidden streams.
    const raw = el.innerText || el.textContent || '';
    return raw.replace(/\s+\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
  }

  function queryAll(selectors) {
    for (const sel of selectors) {
      try {
        const nodes = Array.from(document.querySelectorAll(sel));
        if (nodes.length) return nodes;
      } catch {
        // ignore invalid selector, try next
      }
    }
    return [];
  }

  function getUserNodes() {
    return queryAll([
      '[data-message-author-role="user"]',
      '[data-testid^="conversation-turn"] [data-message-author-role="user"]',
      'article [data-message-author-role="user"]'
    ]);
  }

  function getAssistantNodes() {
    return queryAll([
      '[data-message-author-role="assistant"]',
      '[data-testid^="conversation-turn"] [data-message-author-role="assistant"]',
      'article [data-message-author-role="assistant"]',
      '.markdown[data-message-author-role="assistant"]'
    ]);
  }

  // Fallback for older/alternate ChatGPT markup: conversation-turn testids
  // alternate user/assistant turns in DOM order.
  function fallbackPairFromTurns() {
    const turns = Array.from(
      document.querySelectorAll('[data-testid^="conversation-turn"]')
    );
    if (!turns.length) return { prompt: '', response: '' };
    const users = [];
    const assistants = [];
    for (const t of turns) {
      const text = cleanText(t);
      if (!text) continue;
      // Heuristic: turns alternate; classify by position is unreliable,
      // so only use this fallback when role attributes are missing entirely.
      assistants.push(text);
    }
    void users;
    return { prompt: '', response: assistants.length ? assistants[assistants.length - 1] : '' };
  }

  function getLatestInteraction() {
    const onChatGPT = isChatGPTPage();
    if (!onChatGPT) {
      return { prompt: '', response: '', onChatGPT: false, url: window.location.href };
    }
    const userNodes = getUserNodes();
    const assistantNodes = getAssistantNodes();

    let prompt = userNodes.length ? cleanText(userNodes[userNodes.length - 1]) : '';
    let response = assistantNodes.length
      ? cleanText(assistantNodes[assistantNodes.length - 1])
      : '';

    // If role attributes are absent (markup change), try turn-level fallback.
    if (!prompt && !response) {
      const fb = fallbackPairFromTurns();
      response = fb.response;
    }

    return { prompt, response, onChatGPT: true, url: window.location.href };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const types = MSG();
    if (!message || typeof message.type !== 'string') return undefined;

    if (message.type === 'WDAIDT_PING' || message.type === types.PING) {
      sendResponse({ ok: true, onChatGPT: isChatGPTPage(), version: '0.1.0' });
      return true;
    }

    if (message.type === types.GET_LATEST || message.type === 'WDAIDT_GET_LATEST') {
      try {
        sendResponse({ ok: true, ...getLatestInteraction() });
      } catch (err) {
        sendResponse({ ok: false, prompt: '', response: '', onChatGPT: isChatGPTPage(), error: String(err) });
      }
      return true;
    }

    return undefined;
  });

  // Debug hook: lets Day-1 testers run
  //   await window.__WDAIDT__.getLatest()
  // in DevTools on a ChatGPT tab.
  try {
    window.__WDAIDT__ = Object.freeze({
      version: '0.1.0',
      isChatGPTPage,
      getLatest: getLatestInteraction
    });
  } catch {
    // non-fatal
  }
})();
