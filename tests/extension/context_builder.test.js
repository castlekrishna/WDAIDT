// tests/extension/context_builder.test.js
// Unit and integration tests for WDAIDT V3 Context Builder

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockIndexedDB, MockIDBKeyRange } = require('./fixtures/mock_idb.js');
const WDAIDT_DB = require('../../extension/src/shared/db.js');
const { buildConversationContext } = require('../../extension/src/shared/context_builder.js');

test('context builder: selects recent messages in correct chronological order', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ctx_recent_order' });

  await storage.createConversation({
    conversationId: 'conv_1',
    externalChatId: 'chat_1',
    completenessStatus: 'complete'
  });

  // Create 4 exchanges (8 messages)
  for (let i = 1; i <= 4; i++) {
    await storage.createMessage({
      messageId: `msg_u_${i}`,
      conversationId: 'conv_1',
      role: 'user',
      turnSequence: (i * 2) - 2,
      content: `User question ${i}`
    });
    await storage.createMessage({
      messageId: `msg_a_${i}`,
      conversationId: 'conv_1',
      role: 'assistant',
      turnSequence: (i * 2) - 1,
      content: `Assistant answer ${i}`
    });
  }

  // Ask for max 2 recent exchanges
  const result = await buildConversationContext(storage, {
    conversationId: 'conv_1',
    maxExchanges: 2,
    maxTotalChars: 10000
  });

  assert.equal(result.exchanges.length, 2);
  // Chronological order should be exchange 3, then exchange 4
  assert.equal(result.exchanges[0].prompt, 'User question 3');
  assert.equal(result.exchanges[0].response, 'Assistant answer 3');
  assert.equal(result.exchanges[1].prompt, 'User question 4');
  assert.equal(result.exchanges[1].response, 'Assistant answer 4');
  assert.equal(result.isPartial, false);
});

test('context builder: enforces strict character budget by dropping older exchanges first', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ctx_budget' });

  await storage.createConversation({
    conversationId: 'conv_budget',
    externalChatId: 'chat_budget',
    completenessStatus: 'complete'
  });

  // Exchange 1: 100 chars
  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'conv_budget',
    role: 'user',
    turnSequence: 0,
    content: 'A'.repeat(50)
  });
  await storage.createMessage({
    messageId: 'm2',
    conversationId: 'conv_budget',
    role: 'assistant',
    turnSequence: 1,
    content: 'B'.repeat(50)
  });

  // Exchange 2: 100 chars
  await storage.createMessage({
    messageId: 'm3',
    conversationId: 'conv_budget',
    role: 'user',
    turnSequence: 2,
    content: 'C'.repeat(50)
  });
  await storage.createMessage({
    messageId: 'm4',
    conversationId: 'conv_budget',
    role: 'assistant',
    turnSequence: 3,
    content: 'D'.repeat(50)
  });

  // Total budget = 150 chars. Both exchanges require 200 chars.
  // Priority dictates retaining the most recent exchange (Exchange 2) and dropping Exchange 1.
  const result = await buildConversationContext(storage, {
    conversationId: 'conv_budget',
    maxExchanges: 5,
    maxTotalChars: 150
  });

  assert.equal(result.exchanges.length, 1);
  assert.equal(result.exchanges[0].prompt, 'C'.repeat(50));
  assert.equal(result.exchanges[0].response, 'D'.repeat(50));
  assert.equal(result.isPartial, true);
  assert.ok(result.partialReasons.includes('budget_truncated'));
});

test('context builder: deduplicates current interaction from stored history', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ctx_dedupe' });

  await storage.createConversation({
    conversationId: 'conv_dedupe',
    externalChatId: 'chat_dedupe',
    completenessStatus: 'complete'
  });

  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'conv_dedupe',
    role: 'user',
    turnSequence: 0,
    content: 'Prior question'
  });
  await storage.createMessage({
    messageId: 'm2',
    conversationId: 'conv_dedupe',
    role: 'assistant',
    turnSequence: 1,
    content: 'Prior answer'
  });

  // Latest messages in DB match what the UI is currently analyzing
  await storage.createMessage({
    messageId: 'm3',
    conversationId: 'conv_dedupe',
    role: 'user',
    turnSequence: 2,
    content: 'Current question being analyzed'
  });
  await storage.createMessage({
    messageId: 'm4',
    conversationId: 'conv_dedupe',
    role: 'assistant',
    turnSequence: 3,
    content: 'Current answer being analyzed'
  });

  const result = await buildConversationContext(storage, {
    conversationId: 'conv_dedupe',
    currentExchange: {
      prompt: 'Current question being analyzed',
      response: 'Current answer being analyzed'
    },
    maxExchanges: 5,
    maxTotalChars: 10000
  });

  // The current exchange must not be duplicated into history
  assert.equal(result.exchanges.length, 1);
  assert.equal(result.exchanges[0].prompt, 'Prior question');
  assert.equal(result.exchanges[0].response, 'Prior answer');
});

test('context builder: integrates summary when present and handles summary absence gracefully', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ctx_summary' });

  await storage.createConversation({
    conversationId: 'conv_sum',
    externalChatId: 'chat_sum',
    completenessStatus: 'complete'
  });

  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'conv_sum',
    role: 'user',
    turnSequence: 0,
    content: 'Recent prompt'
  });
  await storage.createMessage({
    messageId: 'm2',
    conversationId: 'conv_sum',
    role: 'assistant',
    turnSequence: 1,
    content: 'Recent response'
  });

  // Test Case A: Without summary
  const resNoSummary = await buildConversationContext(storage, {
    conversationId: 'conv_sum',
    maxExchanges: 5
  });
  assert.equal(resNoSummary.summary, null);
  assert.equal(resNoSummary.exchanges.length, 1);
  assert.equal(resNoSummary.exchanges[0].prompt, 'Recent prompt');

  // Test Case B: With summary added
  await storage.setConversationMemory({
    conversationId: 'conv_sum',
    compactSummary: 'User previously inquired about project setup and architecture guidelines.',
    memoryStatus: 'ready'
  });

  const resWithSummary = await buildConversationContext(storage, {
    conversationId: 'conv_sum',
    maxExchanges: 5
  });

  assert.ok(resWithSummary.summary);
  assert.equal(resWithSummary.exchanges.length, 2);
  // Summary is placed as head exchange
  assert.ok(resWithSummary.exchanges[0].prompt.includes('summary'));
  assert.ok(resWithSummary.exchanges[0].response.includes('project setup'));
  assert.equal(resWithSummary.exchanges[1].prompt, 'Recent prompt');
});

test('context builder: detects uncertain ordering and incomplete history', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ctx_uncertain' });

  await storage.createConversation({
    conversationId: 'conv_unc',
    externalChatId: 'chat_unc',
    completenessStatus: 'partial'
  });

  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'conv_unc',
    role: 'user',
    turnSequence: 0,
    orderConfidence: 'order_uncertain',
    content: 'Prompt'
  });
  await storage.createMessage({
    messageId: 'm2',
    conversationId: 'conv_unc',
    role: 'assistant',
    turnSequence: 1,
    content: 'Response'
  });

  const result = await buildConversationContext(storage, {
    conversationId: 'conv_unc'
  });

  assert.equal(result.isPartial, true);
  assert.ok(result.partialReasons.includes('completeness_partial'));
  assert.ok(result.partialReasons.includes('order_uncertain'));
});

test('context builder: never invents missing messages for unpaired turns', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ctx_unpaired' });

  await storage.createConversation({
    conversationId: 'conv_unp',
    externalChatId: 'chat_unp',
    completenessStatus: 'complete'
  });

  // Single lone assistant message without a prompt
  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'conv_unp',
    role: 'assistant',
    turnSequence: 0,
    content: 'Assistant text with no preceding user prompt'
  });

  const result = await buildConversationContext(storage, {
    conversationId: 'conv_unp'
  });

  // Should not invent a prompt
  assert.equal(result.exchanges.length, 0);
  assert.equal(result.isPartial, true);
  assert.ok(result.partialReasons.includes('unpaired_message'));
});

test('context builder: falls back to DOM history when DB has no stored records', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ctx_fallback' });

  const fallback = [
    { prompt: 'DOM prompt 1', response: 'DOM response 1' },
    { prompt: 'DOM prompt 2', response: 'DOM response 2' }
  ];

  const result = await buildConversationContext(storage, {
    conversationId: 'non_existent_conv',
    fallbackHistory: fallback,
    maxExchanges: 5
  });

  assert.equal(result.exchanges.length, 2);
  assert.equal(result.exchanges[0].prompt, 'DOM prompt 1');
  assert.equal(result.exchanges[1].prompt, 'DOM prompt 2');
});

test('context builder: respects maxExchanges = 0 setting', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ctx_zero' });

  await storage.createConversation({
    conversationId: 'conv_zero',
    externalChatId: 'chat_zero',
    completenessStatus: 'complete'
  });

  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'conv_zero',
    role: 'user',
    turnSequence: 0,
    content: 'Prompt'
  });
  await storage.createMessage({
    messageId: 'm2',
    conversationId: 'conv_zero',
    role: 'assistant',
    turnSequence: 1,
    content: 'Response'
  });

  const result = await buildConversationContext(storage, {
    conversationId: 'conv_zero',
    maxExchanges: 0
  });

  assert.equal(result.exchanges.length, 0);
  assert.equal(result.totalChars, 0);
});
