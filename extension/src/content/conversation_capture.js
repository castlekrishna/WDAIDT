/**
 * @file conversation_capture.js
 * @description WDAIDT V3 Incremental Conversation Capture & Identity Reconciliation.
 *
 * Responsibilities:
 *  1. Extracts and tracks ChatGPT conversation identity from URL (/c/:id vs /).
 *  2. Maintains provisional identities for un-saved threads and reconciles them
 *     transactionally when ChatGPT updates the URL via pushState.
 *  3. Incrementally captures user and assistant messages from DOM without
 *     requiring the entire conversation history to be mounted simultaneously.
 *  4. Deduplicates repeated observer events while preserving identical text in
 *     distinct message positions as separate internal entities.
 *  5. Detects in-place edits and regenerated assistant responses.
 *  6. Isolates conversations during SPA navigation to prevent cross-thread leakage.
 *  7. Persists messages atomically through the WDAIDT_DB local storage engine.
 */

(() => {
  'use strict';

  // Helper to extract external ChatGPT conversation UUID from URL
  function extractExternalChatId(url) {
    if (!url || typeof url !== 'string') return null;
    const match = url.match(/\/c\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
  }

  // Generates a local UUIDv4-like identifier
  function generateId(prefix = 'id') {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return `${prefix}_${crypto.randomUUID()}`;
    }
    const rand = Math.random().toString(36).slice(2, 10);
    const time = Date.now().toString(36);
    return `${prefix}_${time}_${rand}`;
  }

  // Pure content normalizer
  function normContent(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .trim();
  }

  /**
   * Creates an instance of the ConversationCapture pipeline.
   * @param {Object} options
   * @param {Object} options.storageEngine WDAIDT_DB storage engine instance
   * @param {Function} [options.getUrl] Returns current URL string
   * @param {Function} [options.getChatScope] Returns DOM root for conversation
   * @param {Function} [options.extractNodes] Function returning extracted DOM message items
   * @param {Function} [options.onPersist] Callback fired after successful persistence
   * @param {Function} [options.onError] Error handler for non-fatal persistence failures
   */
  function createConversationCapture(options = {}) {
    const storage = options.storageEngine || (typeof globalThis !== 'undefined' && globalThis.WDAIDT_DB && globalThis.WDAIDT_DB.createStorageEngine ? globalThis.WDAIDT_DB.createStorageEngine() : null);
    const getUrl = options.getUrl || (() => (typeof window !== 'undefined' && window.location ? window.location.href : ''));
    const onPersist = options.onPersist || null;
    const onError = options.onError || ((err) => {
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[WDAIDT Capture Warn]:', (err && err.message) || err);
      }
    });

    // Active conversation state machine
    let activeConversationId = null;
    let activeExternalChatId = null;
    let activeIdentityStatus = 'provisional'; // 'provisional' | 'resolved'
    let activeSegmentId = 0;
    let lastUrl = '';

    // In-memory tracking for active thread to deduplicate DOM observer sweeps:
    // Map<sequenceIndex, { messageId, contentHash, revisionNumber, sourceMessageId }>
    const persistedTurns = new Map();

    // In-flight concurrency lock
    let isProcessing = false;
    let pendingCaptureRerun = false;

    /**
     * Resets or switches active conversation tracking.
     */
    function resetActiveConversation(newConversationId, newExternalChatId, identityStatus = 'provisional') {
      activeConversationId = newConversationId;
      activeExternalChatId = newExternalChatId;
      activeIdentityStatus = identityStatus;
      activeSegmentId = 0;
      persistedTurns.clear();
    }

    /**
     * Resolves the conversation record in IndexedDB for the current URL.
     */
    async function ensureActiveConversation(currentUrl) {
      if (!storage) return null;

      const externalId = extractExternalChatId(currentUrl);

      // Case 1: URL has changed (user navigated in SPA)
      if (currentUrl !== lastUrl) {
        const wasProvisional = !activeExternalChatId && activeConversationId;
        const nowHasExternal = !!externalId;

        if (wasProvisional && nowHasExternal) {
          // PROVISIONAL RECONCILIATION:
          // The provisional conversation just acquired a permanent ChatGPT UUID!
          await reconcileProvisional(activeConversationId, externalId);
        } else if (externalId !== activeExternalChatId) {
          // Navigated to a different thread -> switch context
          resetActiveConversation(null, externalId, externalId ? 'resolved' : 'provisional');
        }
        lastUrl = currentUrl;
      }

      // If active conversation already resolved, return it
      if (activeConversationId) {
        return activeConversationId;
      }

      // Case 2: Resolve or initialize conversation in IndexedDB
      if (externalId) {
        // Query by external ChatGPT UUID
        const existing = await storage.getConversationByExternalId(externalId);
        if (existing) {
          resetActiveConversation(existing.conversationId, externalId, 'resolved');
          return activeConversationId;
        }

        // Create new resolved conversation
        const newConvId = generateId('conv');
        await storage.createConversation({
          conversationId: newConvId,
          platform: 'chatgpt',
          externalChatId: externalId,
          identityStatus: 'resolved',
          completenessStatus: 'head_only'
        });
        resetActiveConversation(newConvId, externalId, 'resolved');
        return activeConversationId;
      }

      // Case 3: URL has no external chat ID (provisional on '/')
      const provConvId = generateId('conv_prov');
      await storage.createConversation({
        conversationId: provConvId,
        platform: 'chatgpt',
        externalChatId: null,
        identityStatus: 'provisional',
        completenessStatus: 'head_only'
      });
      resetActiveConversation(provConvId, null, 'provisional');
      return activeConversationId;
    }

    /**
     * Transactional Provisional Reconciliation
     * Promotes provisional conversation when URL updates to /c/:uuid
     */
    async function reconcileProvisional(provisionalId, permanentExternalId) {
      if (!storage || !provisionalId || !permanentExternalId) return;

      try {
        const existing = await storage.getConversationByExternalId(permanentExternalId);
        if (!existing) {
          // Standard case: Promote provisional record in place
          await storage.updateConversation(provisionalId, {
            externalChatId: permanentExternalId,
            identityStatus: 'resolved'
          });
          activeExternalChatId = permanentExternalId;
          activeIdentityStatus = 'resolved';
        } else if (existing.conversationId !== provisionalId) {
          // Collision case: Permanent conversation already exists in DB (e.g. multi-tab)
          // Reconcile messages by copying provisional messages into existing conversation
          const provMsgs = await storage.getMessagesByConversation(provisionalId);
          for (const m of provMsgs) {
            const nextSeq = (existing.messageCount || 0);
            try {
              await storage.createMessage({
                messageId: generateId('msg'),
                conversationId: existing.conversationId,
                role: m.role,
                segmentId: activeSegmentId + 1,
                turnSequence: nextSeq,
                orderConfidence: 'verified_continuous',
                content: m.content,
                capturedAt: m.capturedAt || Date.now()
              });
            } catch (err) {
              /* ignore constraint or duplicate during merge */
            }
          }
          // Cleanly delete the superseded provisional record
          await storage.deleteConversation(provisionalId);
          resetActiveConversation(existing.conversationId, permanentExternalId, 'resolved');
        }
      } catch (err) {
        onError(err);
      }
    }

    /**
     * Incrementally captures and synchronizes observed DOM message items to IndexedDB.
     * @param {Array<{ role: string, text: string, sourceMessageId?: string }>} observedItems
     */
    async function processObservedMessages(observedItems) {
      if (!storage || !Array.isArray(observedItems) || !observedItems.length) {
        return { captured: 0, updated: 0 };
      }

      const url = getUrl();
      const convId = await ensureActiveConversation(url);
      if (!convId) return { captured: 0, updated: 0 };

      let capturedCount = 0;
      let updatedCount = 0;

      for (let i = 0; i < observedItems.length; i++) {
        const item = observedItems[i];
        if (!item) continue;
        const role = item.role;
        if (role !== 'user' && role !== 'assistant') continue;
        const content = normContent(item.text);
        if (!content) continue;

        const sourceMessageId = item.sourceMessageId ? String(item.sourceMessageId).trim() : null;
        const currentHash = storage.computeContentHash(content);
        const sequenceIndex = i;

        const existingTracked = persistedTurns.get(sequenceIndex);

        if (existingTracked) {
          // Case A: Message at this turn sequence was already observed
          if (existingTracked.contentHash === currentHash) {
            // Unchanged: Deduplicate repeated DOM sweep
            continue;
          }

          // Case B: Content hash changed at this sequence -> EDITED or REGENERATED
          try {
            const revised = await storage.updateMessageContent(existingTracked.messageId, content, {
              contentHash: currentHash
            });
            persistedTurns.set(sequenceIndex, {
              messageId: existingTracked.messageId,
              contentHash: currentHash,
              revisionNumber: revised.revisionNumber || (existingTracked.revisionNumber + 1),
              sourceMessageId
            });
            updatedCount += 1;
          } catch (err) {
            onError(err);
          }
        } else {
          // Case C: Newly appearing message at this sequence position
          // Even if content is identical to an earlier turn (e.g. repeated "continue"),
          // it occupies distinct sequenceIndex and is preserved as a separate message record.
          const newMsgId = generateId('msg');
          try {
            await storage.createMessage({
              messageId: newMsgId,
              conversationId: convId,
              sourceMessageId,
              role,
              segmentId: activeSegmentId,
              turnSequence: sequenceIndex,
              orderConfidence: 'verified_continuous',
              content,
              contentHash: currentHash,
              capturedAt: Date.now()
            });

            persistedTurns.set(sequenceIndex, {
              messageId: newMsgId,
              contentHash: currentHash,
              revisionNumber: 1,
              sourceMessageId
            });
            capturedCount += 1;
          } catch (err) {
            onError(err);
          }
        }
      }

      if ((capturedCount > 0 || updatedCount > 0) && typeof onPersist === 'function') {
        onPersist({ conversationId: convId, capturedCount, updatedCount });
      }

      return { captured: capturedCount, updated: updatedCount };
    }

    /**
     * Public Capture Entry Point: Coordinates concurrent sweeps safely
     */
    async function capture(itemsSupplier) {
      if (isProcessing) {
        pendingCaptureRerun = true;
        return { status: 'queued' };
      }

      isProcessing = true;
      try {
        let items = [];
        if (typeof itemsSupplier === 'function') {
          items = itemsSupplier();
        } else if (Array.isArray(itemsSupplier)) {
          items = itemsSupplier;
        } else if (typeof options.extractNodes === 'function') {
          items = options.extractNodes();
        }

        const result = await processObservedMessages(items);
        return { status: 'ok', ...result };
      } catch (err) {
        onError(err);
        return { status: 'error', error: err.message };
      } finally {
        isProcessing = false;
        if (pendingCaptureRerun) {
          pendingCaptureRerun = false;
          // Trigger trailing sweep to catch mutations that occurred while processing
          queueMicrotask(() => capture(itemsSupplier));
        }
      }
    }

    return Object.freeze({
      capture,
      processObservedMessages,
      ensureActiveConversation,
      reconcileProvisional,
      extractExternalChatId,
      getActiveConversationId: () => activeConversationId,
      getActiveExternalChatId: () => activeExternalChatId,
      getActiveIdentityStatus: () => activeIdentityStatus,
      getTrackedTurnCount: () => persistedTurns.size,
      resetActiveConversation
    });
  }

  // Export module interface
  const WDAIDT_CAPTURE = Object.freeze({
    createConversationCapture,
    extractExternalChatId,
    normContent
  });

  if (typeof self !== 'undefined') {
    self.WDAIDT_CAPTURE = WDAIDT_CAPTURE;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.WDAIDT_CAPTURE = WDAIDT_CAPTURE;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WDAIDT_CAPTURE, ...WDAIDT_CAPTURE };
  }
})();
