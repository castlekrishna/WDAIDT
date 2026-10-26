/**
 * @file retention.js
 * @description WDAIDT V3 Storage Retention & Budget Manager.
 *
 * Responsibilities:
 *  1. Enforces retention period (default: 90 days) by purging expired conversation
 *     records along with associated messages, summaries, and metadata.
 *  2. Enforces application storage budget (default: 100 MB).
 *  3. When over budget, cleans expired data first, then oldest inactive conversations.
 *  4. Protects the active conversation from deletion.
 *  5. If the active conversation alone exceeds the budget, halts without silently
 *     dropping newly captured messages.
 *  6. Keeps storage accounting (message counts, character counts, byte estimates) consistent.
 *  7. Handles IndexedDB quota or cleanup failures gracefully without crashing.
 */

(() => {
  'use strict';

  const DEFAULT_RETENTION_DAYS = 90;
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  // 100 MB default storage budget
  const DEFAULT_BUDGET_BYTES = 100 * 1024 * 1024;

  /**
   * Executes retention policy and storage budget cleanup.
   *
   * @param {Object} storage - WDAIDT storage engine
   * @param {Object} [options]
   * @param {number} [options.retentionDays=90] - Max age in days before a conversation expires
   * @param {number} [options.budgetBytes=104857600] - Max allowed database size in estimated bytes
   * @param {string} [options.activeConversationId=null] - Active conversation ID protected from deletion
   * @param {number} [options.now=Date.now()] - Timestamp reference for age calculation
   *
   * @returns {Promise<Object>} RetentionReport:
   * {
   *   success: boolean,
   *   expiredDeletedCount: number,
   *   budgetDeletedCount: number,
   *   totalDeletedCount: number,
   *   reclaimedBytes: number,
   *   remainingConversations: number,
   *   finalEstimatedSizeBytes: number,
   *   overBudget: boolean,
   *   activeConversationProtected: boolean,
   *   activeConversationExceedsBudget: boolean,
   *   deletedConversationIds: Array<string>,
   *   error?: string
   * }
   */
  async function runStorageRetention(storage, options = {}) {
    const report = {
      success: false,
      expiredDeletedCount: 0,
      budgetDeletedCount: 0,
      totalDeletedCount: 0,
      reclaimedBytes: 0,
      remainingConversations: 0,
      finalEstimatedSizeBytes: 0,
      overBudget: false,
      activeConversationProtected: false,
      activeConversationExceedsBudget: false,
      deletedConversationIds: []
    };

    if (!storage || typeof storage.listConversations !== 'function') {
      report.error = 'Storage engine not provided or invalid.';
      return report;
    }

    const retentionDays = typeof options.retentionDays === 'number' && options.retentionDays >= 0
      ? options.retentionDays
      : DEFAULT_RETENTION_DAYS;

    const budgetBytes = typeof options.budgetBytes === 'number' && options.budgetBytes >= 0
      ? options.budgetBytes
      : DEFAULT_BUDGET_BYTES;

    const activeConversationId = options.activeConversationId ? String(options.activeConversationId).trim() : null;
    const now = typeof options.now === 'number' ? options.now : Date.now();
    const cutoffTimestamp = now - (retentionDays * MS_PER_DAY);

    try {
      // Step 1: Query all conversations
      const allConvs = await storage.listConversations({ limit: 10000, reverse: false });
      const convMap = new Map();
      for (const c of allConvs) {
        convMap.set(c.conversationId, c);
      }

      // ── Pass 1: Clean Expired Conversations ───────────────────────────────
      for (const conv of allConvs) {
        const lastActive = conv.lastActivityAt || conv.createdAt || 0;
        if (lastActive < cutoffTimestamp) {
          if (activeConversationId && conv.conversationId === activeConversationId) {
            // Protect the active conversation even if its timestamp is past cutoff
            report.activeConversationProtected = true;
            continue;
          }

          // Atomically delete conversation and its child messages & memory
          const delRes = await storage.deleteConversation(conv.conversationId);
          if (delRes && delRes.deleted) {
            report.expiredDeletedCount++;
            report.deletedConversationIds.push(conv.conversationId);
            report.reclaimedBytes += (conv.estimatedSizeBytes || 128);
            convMap.delete(conv.conversationId);
          }
        }
      }

      // ── Pass 2: Check Application Storage Budget ─────────────────────────
      let accounting = await storage.getStorageAccounting();
      let currentDbSize = accounting.estimatedStorageBytes != null
        ? accounting.estimatedStorageBytes
        : (accounting.estimatedDatabaseSizeBytes || 0);

      if (currentDbSize > budgetBytes) {
        // Sort remaining inactive conversations oldest first (lowest lastActivityAt)
        const remainingConvs = Array.from(convMap.values()).sort((a, b) => {
          const aTime = a.lastActivityAt || a.createdAt || 0;
          const bTime = b.lastActivityAt || b.createdAt || 0;
          return aTime - bTime;
        });

        for (const conv of remainingConvs) {
          if (currentDbSize <= budgetBytes) {
            break;
          }

          if (activeConversationId && conv.conversationId === activeConversationId) {
            // Do not delete active conversation
            report.activeConversationProtected = true;
            continue;
          }

          const delRes = await storage.deleteConversation(conv.conversationId);
          if (delRes && delRes.deleted) {
            report.budgetDeletedCount++;
            report.deletedConversationIds.push(conv.conversationId);
            const convBytes = conv.estimatedSizeBytes || 128;
            report.reclaimedBytes += convBytes;
            currentDbSize -= convBytes;
            convMap.delete(conv.conversationId);
          }
        }

        // Check if only the active conversation remains and it alone exceeds budget
        if (currentDbSize > budgetBytes) {
          if (activeConversationId && convMap.has(activeConversationId) && convMap.size === 1) {
            report.activeConversationExceedsBudget = true;
          }
        }
      }

      // Step 3: Compute final consistent storage accounting
      const finalAccounting = await storage.getStorageAccounting();
      report.remainingConversations = finalAccounting.conversationCount != null
        ? finalAccounting.conversationCount
        : (finalAccounting.totalConversations || 0);
      report.finalEstimatedSizeBytes = finalAccounting.estimatedStorageBytes != null
        ? finalAccounting.estimatedStorageBytes
        : (finalAccounting.estimatedDatabaseSizeBytes || 0);
      report.overBudget = report.finalEstimatedSizeBytes > budgetBytes;
      report.totalDeletedCount = report.expiredDeletedCount + report.budgetDeletedCount;
      report.success = true;

      return report;
    } catch (err) {
      report.success = false;
      report.error = (err && err.message) || String(err);
      return report;
    }
  }

  const WDAIDT_RETENTION = Object.freeze({
    runStorageRetention,
    DEFAULT_RETENTION_DAYS,
    DEFAULT_BUDGET_BYTES
  });

  if (typeof self !== 'undefined') {
    self.WDAIDT_RETENTION = WDAIDT_RETENTION;
  }
  if (typeof globalThis !== 'undefined') {
    globalThis.WDAIDT_RETENTION = WDAIDT_RETENTION;
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { WDAIDT_RETENTION, runStorageRetention };
  }
})();
