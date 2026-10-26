// tests/extension/summarizer.test.js
// Unit and integration tests for WDAIDT V3 Incremental Conversation Summarizer

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMockIndexedDB, MockIDBKeyRange } = require('./fixtures/mock_idb.js');
const WDAIDT_DB = require('../../extension/src/shared/db.js');
const { summarizeConversation, parseSummarySections, buildIncrementalSummaryPrompt } = require('../../extension/src/shared/summarizer.js');
const { buildConversationContext } = require('../../extension/src/shared/context_builder.js');

test('summarizer: initial summary creation extracts structured fields and checkpoint', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_sum_initial' });

  await storage.createConversation({
    conversationId: 'c_init',
    externalChatId: 'chat_init',
    completenessStatus: 'complete'
  });

  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'c_init',
    role: 'user',
    turnSequence: 0,
    content: 'We need to build a distributed cache in Rust with 100ms TTL constraint.'
  });
  await storage.createMessage({
    messageId: 'm2',
    conversationId: 'c_init',
    role: 'assistant',
    turnSequence: 1,
    content: 'Understood. We will use tokio and an LRU eviction strategy.'
  });

  // Mock generator mimicking Gemini output
  const mockGen = async (prompt) => {
    return [
      'Goal: Build a distributed cache in Rust with 100ms TTL',
      'Facts: Using Tokio; LRU eviction strategy',
      'Constraints: 100ms TTL limit; Rust language',
      'Decisions: Use LRU eviction with Tokio runtime',
      'Unresolved: None',
      'Next Steps: Write connection pool interface'
    ].join('\n');
  };

  const res = await summarizeConversation(storage, {
    conversationId: 'c_init',
    generateSummary: mockGen
  });

  assert.equal(res.success, true);
  assert.equal(res.status, 'ready');
  assert.equal(res.memory.summaryRevision, 1);
  assert.equal(res.memory.sourceMessageCheckpoint, 'm2');
  assert.ok(res.memory.compactSummary.includes('distributed cache in Rust'));
  assert.ok(res.memory.constraints.includes('100ms TTL limit'));

  // Verify memory record in DB
  const memInDb = await storage.getConversationMemory('c_init');
  assert.equal(memInDb.status, 'ready');
  assert.equal(memInDb.summaryRevision, 1);
  assert.equal(memInDb.sourceMessageCheckpoint, 'm2');
});

test('summarizer: incremental summary update includes only new turns and preserves checkpoint', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_sum_incremental' });

  await storage.createConversation({ conversationId: 'c_inc' });

  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'c_inc',
    role: 'user',
    turnSequence: 0,
    content: 'Initial objective: design API.'
  });
  await storage.createMessage({
    messageId: 'm2',
    conversationId: 'c_inc',
    role: 'assistant',
    turnSequence: 1,
    content: 'API designed.'
  });

  // Initial summary
  await summarizeConversation(storage, {
    conversationId: 'c_inc',
    generateSummary: async () => 'Goal: Design API\nFacts: Initial design\nConstraints: None\nDecisions: Approved\nUnresolved: None\nNext Steps: Add auth'
  });

  // Add 2 new turns (m3, m4)
  await storage.createMessage({
    messageId: 'm3',
    conversationId: 'c_inc',
    role: 'user',
    turnSequence: 2,
    content: 'We must use OAuth2 with JWT tokens for authentication.'
  });
  await storage.createMessage({
    messageId: 'm4',
    conversationId: 'c_inc',
    role: 'assistant',
    turnSequence: 3,
    content: 'Configured OAuth2 with RS256 signature verification.'
  });

  let capturedPrompt = '';
  const incrementalGen = async (prompt) => {
    capturedPrompt = prompt;
    return 'Goal: Design API with OAuth2\nFacts: Using RS256 JWT\nConstraints: OAuth2 only\nDecisions: Approved RS256\nUnresolved: Token expiry\nNext Steps: Deploy';
  };

  const updateRes = await summarizeConversation(storage, {
    conversationId: 'c_inc',
    generateSummary: incrementalGen
  });

  assert.equal(updateRes.success, true);
  assert.equal(updateRes.status, 'ready');
  assert.equal(updateRes.memory.summaryRevision, 2);
  assert.equal(updateRes.memory.sourceMessageCheckpoint, 'm4');

  // Verify the prompt passed to the generator contained the previous summary AND only the new turns
  assert.ok(capturedPrompt.includes('PREVIOUS SUMMARY:'));
  assert.ok(capturedPrompt.includes('Goal: Design API'));
  assert.ok(capturedPrompt.includes('OAuth2 with JWT'));
  // m1 should NOT be repeated in the new turns section
  assert.ok(!capturedPrompt.includes('[Turn 1] User: Initial objective: design API.'));
});

test('summarizer: returns no-op when conversation content has not changed', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_sum_noop' });

  await storage.createConversation({ conversationId: 'c_noop' });
  await storage.createMessage({ messageId: 'm1', conversationId: 'c_noop', role: 'user', turnSequence: 0, content: 'Hi' });
  await storage.createMessage({ messageId: 'm2', conversationId: 'c_noop', role: 'assistant', turnSequence: 1, content: 'Hello' });

  let calls = 0;
  const gen = async () => {
    calls++;
    return 'Goal: Greeting\nFacts: None\nConstraints: None\nDecisions: None\nUnresolved: None\nNext Steps: None';
  };

  // First run: calls generator
  const res1 = await summarizeConversation(storage, { conversationId: 'c_noop', generateSummary: gen });
  assert.equal(res1.status, 'ready');
  assert.equal(calls, 1);

  // Second run immediately without any new messages
  const res2 = await summarizeConversation(storage, { conversationId: 'c_noop', generateSummary: gen });
  assert.equal(res2.status, 'no_op');
  assert.equal(res2.reason, 'up_to_date');
  assert.equal(calls, 1); // Generator was not called again!
});

test('summarizer: marks summary stale upon message edit and full re-evaluation', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_sum_stale' });

  await storage.createConversation({ conversationId: 'c_stale' });
  await storage.createMessage({ messageId: 'm1', conversationId: 'c_stale', role: 'user', turnSequence: 0, content: 'Original prompt' });
  await storage.createMessage({ messageId: 'm2', conversationId: 'c_stale', role: 'assistant', turnSequence: 1, content: 'Original answer' });

  // Create initial summary
  await summarizeConversation(storage, {
    conversationId: 'c_stale',
    generateSummary: async () => 'Goal: Original\nFacts: None\nConstraints: None\nDecisions: None\nUnresolved: None\nNext Steps: None'
  });

  const memBefore = await storage.getConversationMemory('c_stale');
  assert.equal(memBefore.status, 'ready');

  // Perform in-place message edit via storage engine policy
  await storage.updateMessageContent('m1', 'Completely revised prompt with changed requirements');

  // Verify DB marked memory status as stale automatically
  const memAfterEdit = await storage.getConversationMemory('c_stale');
  assert.equal(memAfterEdit.status, 'stale');

  // Running summarizer now detects stale status and rebuilds from full updated conversation
  let passedPrompt = '';
  const res = await summarizeConversation(storage, {
    conversationId: 'c_stale',
    generateSummary: async (p) => {
      passedPrompt = p;
      return 'Goal: Revised\nFacts: Changed\nConstraints: None\nDecisions: None\nUnresolved: None\nNext Steps: None';
    }
  });

  assert.equal(res.success, true);
  assert.equal(res.status, 'ready');
  assert.equal(res.memory.summaryRevision, 2);
  assert.ok(passedPrompt.includes('Completely revised prompt'));
});

test('summarizer: preserves previous summary when generation attempt fails', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_sum_failure_preserve' });

  await storage.createConversation({ conversationId: 'c_fail' });
  await storage.createMessage({ messageId: 'm1', conversationId: 'c_fail', role: 'user', turnSequence: 0, content: 'Task 1' });
  await storage.createMessage({ messageId: 'm2', conversationId: 'c_fail', role: 'assistant', turnSequence: 1, content: 'Done 1' });

  // Initial successful summary
  const goodSummary = 'Goal: Task 1\nFacts: Established\nConstraints: None\nDecisions: None\nUnresolved: None\nNext Steps: None';
  await summarizeConversation(storage, {
    conversationId: 'c_fail',
    generateSummary: async () => goodSummary
  });

  // Add new messages
  await storage.createMessage({ messageId: 'm3', conversationId: 'c_fail', role: 'user', turnSequence: 2, content: 'Task 2' });
  await storage.createMessage({ messageId: 'm4', conversationId: 'c_fail', role: 'assistant', turnSequence: 3, content: 'Done 2' });

  // Failed generator (e.g. 503 rate limit / network error)
  const failingGen = async () => {
    throw new Error('Gemini API 503: Service Unavailable');
  };

  const res = await summarizeConversation(storage, {
    conversationId: 'c_fail',
    generateSummary: failingGen
  });

  assert.equal(res.success, false);
  assert.ok(res.error.includes('503'));
  assert.equal(res.preservedSummary, goodSummary);

  // Check DB state: previous compactSummary must still be intact and retry count incremented
  const memInDb = await storage.getConversationMemory('c_fail');
  assert.equal(memInDb.compactSummary, goodSummary);
  assert.equal(memInDb.retryCount, 1);
  assert.ok(memInDb.lastError.includes('503'));
});

test('summarizer: concurrency check prevents stale asynchronous response from overwriting newer summary', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_sum_concurrency' });

  await storage.createConversation({ conversationId: 'c_conc' });
  await storage.createMessage({ messageId: 'm1', conversationId: 'c_conc', role: 'user', turnSequence: 0, content: 'A' });
  await storage.createMessage({ messageId: 'm2', conversationId: 'c_conc', role: 'assistant', turnSequence: 1, content: 'B' });

  // Simulate Slow Worker:
  // Starts generation when revision is 0 (targeting revision 1)
  let resolveSlow;
  const slowPromise = new Promise(r => { resolveSlow = r; });
  const slowGen = async () => {
    await slowPromise;
    return 'Goal: Slow summary that resolved late\nFacts: Outdated\nConstraints: None\nDecisions: None\nUnresolved: None\nNext Steps: None';
  };

  const slowRunPromise = summarizeConversation(storage, {
    conversationId: 'c_conc',
    generateSummary: slowGen
  });

  // Fast Worker completes in the meantime and commits revision 1
  const fastGen = async () => 'Goal: Fast Newer Summary\nFacts: Current\nConstraints: None\nDecisions: None\nUnresolved: None\nNext Steps: None';
  const fastRes = await summarizeConversation(storage, {
    conversationId: 'c_conc',
    generateSummary: fastGen
  });
  assert.equal(fastRes.memory.summaryRevision, 1);

  // Now let the slow worker complete
  resolveSlow();
  const slowRes = await slowRunPromise;

  // Slow worker must NOT overwrite the newer revision
  assert.equal(slowRes.status, 'stale_response');
  assert.equal(slowRes.reason, 'superseded_by_newer_revision');

  const finalMem = await storage.getConversationMemory('c_conc');
  assert.ok(finalMem.compactSummary.includes('Fast Newer Summary'));
  assert.ok(!finalMem.compactSummary.includes('Slow summary that resolved late'));
});

test('context builder integration: handles ready, missing, and stale summaries gracefully', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_sum_ctx_integration' });

  await storage.createConversation({ conversationId: 'c_ctx', completenessStatus: 'complete' });
  await storage.createMessage({ messageId: 'm1', conversationId: 'c_ctx', role: 'user', turnSequence: 0, content: 'Older prompt' });
  await storage.createMessage({ messageId: 'm2', conversationId: 'c_ctx', role: 'assistant', turnSequence: 1, content: 'Older answer' });
  await storage.createMessage({ messageId: 'm3', conversationId: 'c_ctx', role: 'user', turnSequence: 2, content: 'Recent prompt' });
  await storage.createMessage({ messageId: 'm4', conversationId: 'c_ctx', role: 'assistant', turnSequence: 3, content: 'Recent answer' });

  // 1. Without summary: older raw turns packed as fallback
  const resNoSummary = await buildConversationContext(storage, { conversationId: 'c_ctx', maxExchanges: 5 });
  assert.equal(resNoSummary.summary, null);
  assert.equal(resNoSummary.exchanges.length, 2);
  assert.equal(resNoSummary.isPartial, false);

  // 2. With valid ready summary: summary at head, recent turns raw, no duplication of older turns
  await storage.setConversationMemory({
    conversationId: 'c_ctx',
    compactSummary: 'Goal: Project setup\nFacts: Initialized',
    sourceMessageCheckpoint: 'm2',
    status: 'ready',
    summaryRevision: 1
  });

  const resReady = await buildConversationContext(storage, { conversationId: 'c_ctx', maxExchanges: 5 });
  assert.equal(resReady.exchanges.length, 2);
  assert.ok(resReady.exchanges[0].prompt.includes('summary'));
  assert.equal(resReady.exchanges[1].prompt, 'Recent prompt');
  assert.equal(resReady.isPartial, false);

  // 3. With stale summary: summary still available for analysis but flagged as partial
  await storage.setConversationMemory({
    conversationId: 'c_ctx',
    compactSummary: 'Goal: Stale setup\nFacts: Needs refresh',
    status: 'stale',
    summaryRevision: 1
  });

  const resStale = await buildConversationContext(storage, { conversationId: 'c_ctx', maxExchanges: 5 });
  assert.equal(resStale.isPartial, true);
  assert.ok(resStale.partialReasons.includes('stale_summary'));
  // Text is still present for diagnostic aid
  assert.ok(resStale.exchanges[0].response.includes('Stale setup'));
});
