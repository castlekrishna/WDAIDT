/**
 * @file context_builder.js
 * @description WDAIDT V3 Context Builder & Historical Context Assembler.
 *
 * Responsibilities:
 *  1. Assembles relevant conversation history for AI analysis from:
 *     - Current user prompt and assistant response
 *     - Latest available conversation summary (from conversation_memory)
 *     - Configurable window of recent messages
 *     - Relevant older messages when character/exchange budget permits
 *  2. Preserves message roles and chronological sequence order.
 *  3. Never invents missing messages or fakes completeness.
 *  4. Annotates context with `isPartial` and explicit reason codes if gaps,
 *     uncertain ordering, or budget truncations occur.
 *  5. Deduplicates current interaction and repeated message IDs.
 *  6. Produces valid exchange payloads compatible with the V2 /analyze contract.
 */

(() => {
  'use strict';

  const DEFAULT_MAX_EXCHANGES = 5;
  const ABSOLUTE_MAX_EXCHANGES = 20;
  const DEFAULT_MAX_TOTAL_CHARS = 30000;
  const ABSOLUTE_MAX_TOTAL_CHARS = 40000;
  const DEFAULT_SUMMARY_PREFIX = 'Previous conversation summary:';

  /**
   * Builds conversation context for the AI analysis workflow.
   *
   * @param {Object} storage - Initialized WDAIDT storage engine
   * @param {Object} [options]
   * @param {string} [options.conversationId] - Internal conversation UUID
   * @param {string} [options.externalChatId] - ChatGPT route ID (/c/:id)
   * @param {Object} [options.currentExchange] - { prompt: string, response: string }
   * @param {number} [options.maxExchanges=5] - Maximum exchanges to select (0 to 20)
   * @param {number} [options.maxTotalChars=30000] - Total character budget (up to 40000)
   * @param {boolean} [options.includeSummary=true] - Whether to include summary if present
   * @param {string} [options.summaryPrefix] - Heading or role prefix for summary exchange
   * @param {Array} [options.fallbackHistory=[]] - Fallback exchanges from DOM if DB has no stored messages
   *
   * @returns {Promise<Object>} ContextResult:
   * {
   *   exchanges: Array<{ prompt: string, response: string }>,
   *   summary: string | null,
   *   isPartial: boolean,
   *   partialReasons: Array<string>,
   *   totalChars: number,
   *   messagesUsed: number,
   *   totalMessagesInConv: number
   * }
   */
  async function buildConversationContext(storage, options = {}) {
    const maxExchanges = Math.max(
      0,
      Math.min(
        ABSOLUTE_MAX_EXCHANGES,
        typeof options.maxExchanges === 'number'
          ? options.maxExchanges
          : DEFAULT_MAX_EXCHANGES
      )
    );

    const maxTotalChars = Math.max(
      0,
      Math.min(
        ABSOLUTE_MAX_TOTAL_CHARS,
        typeof options.maxTotalChars === 'number'
          ? options.maxTotalChars
          : DEFAULT_MAX_TOTAL_CHARS
      )
    );

    const includeSummary = options.includeSummary !== false;
    const summaryPrefix = String(options.summaryPrefix || DEFAULT_SUMMARY_PREFIX).trim();
    const currentExchange = options.currentExchange || null;
    const fallbackHistory = Array.isArray(options.fallbackHistory) ? options.fallbackHistory : [];

    const result = {
      exchanges: [],
      summary: null,
      isPartial: false,
      partialReasons: [],
      totalChars: 0,
      messagesUsed: 0,
      totalMessagesInConv: 0
    };

    if (maxExchanges === 0 || maxTotalChars === 0) {
      return result;
    }

    if (!storage || typeof storage.getMessagesByConversation !== 'function') {
      return applyFallbackHistory(result, fallbackHistory, maxExchanges, maxTotalChars);
    }

    // Step 1: Resolve conversation record
    let conv = null;
    if (options.conversationId) {
      try {
        conv = await storage.getConversation(options.conversationId);
      } catch {
        conv = null;
      }
    }
    if (!conv && options.externalChatId && typeof storage.getConversationByExternalId === 'function') {
      try {
        conv = await storage.getConversationByExternalId(options.externalChatId);
      } catch {
        conv = null;
      }
    }

    // If no conversation record in DB, use DOM fallback history if available
    if (!conv) {
      return applyFallbackHistory(result, fallbackHistory, maxExchanges, maxTotalChars);
    }

    if (conv.completenessStatus && conv.completenessStatus !== 'complete') {
      result.isPartial = true;
      result.partialReasons.push(`completeness_${conv.completenessStatus}`);
    }

    // Step 2: Retrieve latest summary from conversation_memory
    let summaryText = null;
    if (includeSummary && typeof storage.getConversationMemory === 'function') {
      try {
        const mem = await storage.getConversationMemory(conv.conversationId);
        if (mem && mem.compactSummary && typeof mem.compactSummary === 'string') {
          const s = mem.compactSummary.trim();
          if (s) {
            summaryText = s;
            result.summary = s;
          }
        }
      } catch {
        /* non-fatal memory lookup */
      }
    }

    // Step 3: Retrieve messages from IndexedDB
    let storedMessages = [];
    try {
      storedMessages = await storage.getMessagesByConversation(conv.conversationId, { reverse: false });
    } catch {
      storedMessages = [];
    }

    result.totalMessagesInConv = storedMessages.length;

    if (!storedMessages.length) {
      if (summaryText) {
        // Only summary is available
        const sumLen = summaryPrefix.length + summaryText.length;
        if (sumLen <= maxTotalChars) {
          result.exchanges.push({ prompt: summaryPrefix, response: summaryText });
          result.totalChars = sumLen;
        } else {
          result.isPartial = true;
          result.partialReasons.push('summary_budget_exceeded');
        }
        return result;
      }
      return applyFallbackHistory(result, fallbackHistory, maxExchanges, maxTotalChars);
    }

    // Step 4: Validate order confidence across messages
    for (const msg of storedMessages) {
      if (msg.orderConfidence === 'gap_discontinuous') {
        result.isPartial = true;
        if (!result.partialReasons.includes('gap_discontinuous')) {
          result.partialReasons.push('gap_discontinuous');
        }
      } else if (msg.orderConfidence === 'order_uncertain') {
        result.isPartial = true;
        if (!result.partialReasons.includes('order_uncertain')) {
          result.partialReasons.push('order_uncertain');
        }
      }
    }

    // Step 5: Deduplicate current interaction from message stream
    let msgPool = storedMessages.slice();
    if (currentExchange && currentExchange.prompt && currentExchange.response) {
      const curP = String(currentExchange.prompt).trim();
      const curR = String(currentExchange.response).trim();

      // Check if tail of msgPool matches the current exchange
      if (msgPool.length >= 2) {
        const last1 = msgPool[msgPool.length - 1];
        const last2 = msgPool[msgPool.length - 2];
        if (
          last2.role === 'user' &&
          last1.role === 'assistant' &&
          last2.content.trim() === curP &&
          last1.content.trim() === curR
        ) {
          msgPool = msgPool.slice(0, -2);
        }
      } else if (msgPool.length === 1) {
        const last1 = msgPool[msgPool.length - 1];
        if (last1.role === 'user' && last1.content.trim() === curP) {
          msgPool = [];
        }
      }
    }

    // Step 6: Form complete exchanges from stored messages
    // We walk chronologically and pair user messages with immediate assistant responses
    const pairedExchanges = [];
    let i = 0;
    while (i < msgPool.length) {
      const current = msgPool[i];
      if (current.role === 'user') {
        // Look ahead for the corresponding assistant response
        if (i + 1 < msgPool.length && msgPool[i + 1].role === 'assistant') {
          pairedExchanges.push({
            prompt: current.content.trim(),
            response: msgPool[i + 1].content.trim(),
            turnSequence: msgPool[i + 1].turnSequence
          });
          i += 2;
        } else {
          // Unpaired user message
          result.isPartial = true;
          if (!result.partialReasons.includes('unpaired_message')) {
            result.partialReasons.push('unpaired_message');
          }
          i += 1;
        }
      } else if (current.role === 'assistant') {
        // Unpaired assistant message without preceding user prompt
        result.isPartial = true;
        if (!result.partialReasons.includes('unpaired_message')) {
          result.partialReasons.push('unpaired_message');
        }
        i += 1;
      } else {
        i += 1;
      }
    }

    if (!pairedExchanges.length && !summaryText) {
      return applyFallbackHistory(result, fallbackHistory, maxExchanges, maxTotalChars);
    }

    // Step 7: Budget allocation prioritizing recent messages, summary, then older messages
    // Separate candidates into recent window vs older
    const recentWindowSize = maxExchanges;
    const recentCandidates = pairedExchanges.slice(-recentWindowSize);
    const olderCandidates = pairedExchanges.slice(0, Math.max(0, pairedExchanges.length - recentWindowSize));

    let allocatedExchanges = [];
    let currentTotalChars = 0;

    // First: Pack most recent exchanges (working backwards to retain the freshest complete pairs)
    const keptRecent = [];
    for (let rIdx = recentCandidates.length - 1; rIdx >= 0; rIdx--) {
      const ex = recentCandidates[rIdx];
      const exLen = ex.prompt.length + ex.response.length;
      if (currentTotalChars + exLen <= maxTotalChars && keptRecent.length < maxExchanges) {
        keptRecent.unshift(ex);
        currentTotalChars += exLen;
      } else {
        result.isPartial = true;
        if (!result.partialReasons.includes('budget_truncated')) {
          result.partialReasons.push('budget_truncated');
        }
      }
    }

    // Second: Pack summary if available and room exists in character budget and exchange slots
    let summaryExchange = null;
    if (summaryText) {
      const sumLen = summaryPrefix.length + summaryText.length;
      if (currentTotalChars + sumLen <= maxTotalChars && keptRecent.length < maxExchanges) {
        summaryExchange = { prompt: summaryPrefix, response: summaryText };
        currentTotalChars += sumLen;
      } else {
        result.isPartial = true;
        if (!result.partialReasons.includes('summary_budget_exceeded')) {
          result.partialReasons.push('summary_budget_exceeded');
        }
      }
    }

    // Third: If slots and budget still remain, pack older complete exchanges
    const keptOlder = [];
    const remainingSlots = maxExchanges - keptRecent.length - (summaryExchange ? 1 : 0);
    if (remainingSlots > 0 && olderCandidates.length > 0) {
      for (let oIdx = olderCandidates.length - 1; oIdx >= 0; oIdx--) {
        const ex = olderCandidates[oIdx];
        const exLen = ex.prompt.length + ex.response.length;
        if (currentTotalChars + exLen <= maxTotalChars && keptOlder.length < remainingSlots) {
          keptOlder.unshift(ex);
          currentTotalChars += exLen;
        } else {
          result.isPartial = true;
          if (!result.partialReasons.includes('budget_truncated')) {
            result.partialReasons.push('budget_truncated');
          }
        }
      }
    }

    // Assemble final chronological array: [Summary, Older..., Recent...]
    if (summaryExchange) {
      allocatedExchanges.push(summaryExchange);
    }
    for (const ex of keptOlder) {
      allocatedExchanges.push({ prompt: ex.prompt, response: ex.response });
    }
    for (const ex of keptRecent) {
      allocatedExchanges.push({ prompt: ex.prompt, response: ex.response });
    }

    result.exchanges = allocatedExchanges;
    result.totalChars = currentTotalChars;
    result.messagesUsed = (keptOlder.length + keptRecent.length) * 2;

    return result;
  }

  function applyFallbackHistory(result, fallbackHistory, maxExchanges, maxTotalChars) {
    if (!fallbackHistory || !fallbackHistory.length) {
      return result;
    }
    const valid = [];
    for (const ex of fallbackHistory) {
      if (ex && typeof ex === 'object') {
        const p = typeof ex.prompt === 'string' ? ex.prompt.trim() : '';
        const r = typeof ex.response === 'string' ? ex.response.trim() : '';
        if (p && r) {
          valid.push({ prompt: p, response: r });
        }
      }
    }
    if (!valid.length) return result;

    const candidates = valid.slice(-maxExchanges);
    const kept = [];
    let currentTotal = 0;
    for (let i = candidates.length - 1; i >= 0; i--) {
      const ex = candidates[i];
      const exLen = ex.prompt.length + ex.response.length;
      if (currentTotal + exLen <= maxTotalChars) {
        kept.unshift(ex);
        currentTotal += exLen;
      } else {
        result.isPartial = true;
        result.partialReasons.push('budget_truncated');
        break;
      }
    }

    result.exchanges = kept;
    result.totalChars = currentTotal;
    result.messagesUsed = kept.length * 2;
    result.totalMessagesInConv = valid.length * 2;
    return result;
  }

  const WDAIDT_CONTEXT_BUILDER = Object.freeze({
    buildConversationContext,
    DEFAULT_MAX_EXCHANGES,
    ABSOLUTE_MAX_EXCHANGES,
    DEFAULT_MAX_TOTAL_CHARS,
    ABSOLUTE_MAX_TOTAL_CHARS,
    DEFAULT_SUMMARY_PREFIX
  });

  if (typeof self !== 'undefined') {
    self.WDAIDT_CONTEXT_BUILDER = WDAIDT_CONTEXT_BUILDER;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.WDAIDT_CONTEXT_BUILDER = WDAIDT_CONTEXT_BUILDER;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WDAIDT_CONTEXT_BUILDER, buildConversationContext };
  }
})();
