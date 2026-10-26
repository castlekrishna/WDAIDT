// tests/extension/retention.test.js
// Unit and integration tests for WDAIDT V3 Storage Retention & Budget Manager

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockIndexedDB, MockIDBKeyRange } = require('./fixtures/mock_idb.js');
const WDAIDT_DB = require('../../extension/src/shared/db.js');
const { runStorageRetention } = require('../../extension/src/shared/retention.js');

const DAY_MS = 24 * 60 * 60 * 1000;

test('retention: removes expired conversations and preserves recent conversations', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ret_expired' });

  const now = 1700000000000;
  const expiredTime = now - (95 * DAY_MS); // 95 days old (expired)
  const freshTime = now - (10 * DAY_MS);   // 10 days old (fresh)

  // Expired conversation
  await storage.createConversation({
    conversationId: 'conv_old',
    externalChatId: 'chat_old',
    createdAt: expiredTime,
    lastActivityAt: expiredTime
  });
  await storage.createMessage({
    messageId: 'msg_old',
    conversationId: 'conv_old',
    role: 'user',
    content: 'Old message content',
    capturedAt: expiredTime
  });

  // Fresh conversation
  await storage.createConversation({
    conversationId: 'conv_fresh',
    externalChatId: 'chat_fresh',
    createdAt: freshTime,
    lastActivityAt: freshTime
  });
  await storage.createMessage({
    messageId: 'msg_fresh',
    conversationId: 'conv_fresh',
    role: 'user',
    content: 'Fresh message content',
    capturedAt: freshTime
  });

  const report = await runStorageRetention(storage, {
    retentionDays: 90,
    now
  });

  assert.equal(report.success, true);
  assert.equal(report.expiredDeletedCount, 1);
  assert.ok(report.deletedConversationIds.includes('conv_old'));

  // Verify conv_old is deleted and conv_fresh remains
  const oldConv = await storage.getConversation('conv_old');
  assert.equal(oldConv, null);
  const oldMsg = await storage.getMessage('msg_old');
  assert.equal(oldMsg, null);

  const freshConv = await storage.getConversation('conv_fresh');
  assert.ok(freshConv);
  const freshMsg = await storage.getMessage('msg_fresh');
  assert.ok(freshMsg);
});

test('retention: protects active conversation from expiration deletion', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ret_active_protect' });

  const now = 1700000000000;
  const expiredTime = now - (100 * DAY_MS);

  await storage.createConversation({
    conversationId: 'conv_active_old',
    externalChatId: 'chat_active_old',
    createdAt: expiredTime,
    lastActivityAt: expiredTime
  });

  const report = await runStorageRetention(storage, {
    retentionDays: 90,
    activeConversationId: 'conv_active_old',
    now
  });

  assert.equal(report.success, true);
  assert.equal(report.expiredDeletedCount, 0);
  assert.equal(report.activeConversationProtected, true);

  const conv = await storage.getConversation('conv_active_old');
  assert.ok(conv);
});

test('retention: budget cleanup order deletes expired data first, then oldest inactive conversations', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ret_budget_order' });

  const now = 1700000000000;
  const tExpired = now - (95 * DAY_MS);
  const tOldInactive = now - (50 * DAY_MS);
  const tRecent = now - (5 * DAY_MS);

  // 1. Expired conversation
  await storage.createConversation({
    conversationId: 'c_expired',
    createdAt: tExpired,
    lastActivityAt: tExpired
  });
  await storage.createMessage({
    messageId: 'm_exp',
    conversationId: 'c_expired',
    role: 'user',
    content: 'X'.repeat(500),
    capturedAt: tExpired
  });

  // 2. Oldest inactive conversation (not expired)
  await storage.createConversation({
    conversationId: 'c_old_inactive',
    createdAt: tOldInactive,
    lastActivityAt: tOldInactive
  });
  await storage.createMessage({
    messageId: 'm_old_inact',
    conversationId: 'c_old_inactive',
    role: 'user',
    content: 'Y'.repeat(500),
    capturedAt: tOldInactive
  });

  // 3. Recent conversation
  await storage.createConversation({
    conversationId: 'c_recent',
    createdAt: tRecent,
    lastActivityAt: tRecent
  });
  await storage.createMessage({
    messageId: 'm_recent',
    conversationId: 'c_recent',
    role: 'user',
    content: 'Z'.repeat(500),
    capturedAt: tRecent
  });

  // Check initial size
  const initialAcc = await storage.getStorageAccounting();
  assert.equal(initialAcc.conversationCount, 3);

  // Set budget low enough that c_expired (Pass 1) + c_old_inactive (Pass 2) must be deleted
  // Leave enough room for c_recent alone (approx 128 + 128 + 1000 = ~1256 bytes)
  const budgetBytes = 1500;

  const report = await runStorageRetention(storage, {
    retentionDays: 90,
    budgetBytes,
    now
  });

  assert.equal(report.success, true);
  assert.equal(report.expiredDeletedCount, 1);
  assert.equal(report.budgetDeletedCount, 1);
  assert.ok(report.deletedConversationIds.includes('c_expired'));
  assert.ok(report.deletedConversationIds.includes('c_old_inactive'));

  // c_recent should be preserved
  const recentConv = await storage.getConversation('c_recent');
  assert.ok(recentConv);
});

test('retention: does not delete active conversation even if it alone exceeds budget', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ret_active_alone_budget' });

  const now = 1700000000000;
  const tRecent = now - (1 * DAY_MS);

  await storage.createConversation({
    conversationId: 'c_active_giant',
    createdAt: tRecent,
    lastActivityAt: tRecent
  });
  await storage.createMessage({
    messageId: 'm_giant',
    conversationId: 'c_active_giant',
    role: 'user',
    content: 'W'.repeat(5000),
    capturedAt: tRecent
  });

  // Tiny budget = 100 bytes (conv is ~10KB)
  const report = await runStorageRetention(storage, {
    budgetBytes: 100,
    activeConversationId: 'c_active_giant',
    now
  });

  assert.equal(report.success, true);
  assert.equal(report.totalDeletedCount, 0);
  assert.equal(report.activeConversationProtected, true);
  assert.equal(report.activeConversationExceedsBudget, true);

  // Confirm data was not dropped
  const giant = await storage.getConversation('c_active_giant');
  assert.ok(giant);
  const msg = await storage.getMessage('m_giant');
  assert.ok(msg);
});

test('retention: storage accounting remains consistent after deletions', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ret_accounting_consistency' });

  const now = 1700000000000;
  const expiredTime = now - (100 * DAY_MS);
  const freshTime = now - (5 * DAY_MS);

  // Conv 1 (to be deleted)
  await storage.createConversation({ conversationId: 'c1', createdAt: expiredTime, lastActivityAt: expiredTime });
  await storage.createMessage({ messageId: 'm1', conversationId: 'c1', role: 'user', turnSequence: 0, content: 'Msg 1', capturedAt: expiredTime });
  await storage.createMessage({ messageId: 'm2', conversationId: 'c1', role: 'assistant', turnSequence: 1, content: 'Msg 2', capturedAt: expiredTime });

  // Conv 2 (to be kept)
  await storage.createConversation({ conversationId: 'c2', createdAt: freshTime, lastActivityAt: freshTime });
  await storage.createMessage({ messageId: 'm3', conversationId: 'c2', role: 'user', turnSequence: 0, content: 'Msg 3', capturedAt: freshTime });

  await runStorageRetention(storage, {
    retentionDays: 90,
    now
  });

  const finalAccounting = await storage.getStorageAccounting();
  assert.equal(finalAccounting.conversationCount, 1);
  assert.equal(finalAccounting.totalMessageCount, 1);
  assert.equal(finalAccounting.totalCharacterCount, 'Msg 3'.length);
  assert.ok(finalAccounting.estimatedStorageBytes > 0);
});

test('retention: handles unexpected storage failures gracefully without crashing', async () => {
  // Pass invalid/failing storage
  const brokenStorage = {
    listConversations: async () => {
      throw new Error('Simulated disk/quota I/O error');
    }
  };

  const report = await runStorageRetention(brokenStorage);
  assert.equal(report.success, false);
  assert.ok(report.error.includes('Simulated disk/quota I/O error'));
});
