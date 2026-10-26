// V3.0.0-alpha.2 IndexedDB CRUD, Transactional Integrity & Accounting Tests
// Run with: node --test tests/extension/db_crud.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createMockIndexedDB, MockIDBKeyRange } = require('./fixtures/mock_idb.js');
globalThis.IDBKeyRange = MockIDBKeyRange;

const { WDAIDT_DB } = require(path.join(__dirname, '..', '..', 'extension', 'src', 'shared', 'db.js'));

test('db_crud: conversation creation, retrieval, external lookup, and update', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_crud_conv' });

  // 1. Create provisional conversation
  const created = await engine.createConversation({
    conversationId: 'conv_101',
    platform: 'chatgpt',
    externalChatId: null,
    identityStatus: 'provisional',
    completenessStatus: 'head_only',
    title: 'New Chat'
  });
  assert.equal(created.conversationId, 'conv_101');
  assert.equal(created.identityStatus, 'provisional');
  assert.equal(created.messageCount, 0);
  assert.equal(created.totalCharacterCount, 0);

  // 2. Fetch by PK
  const fetched = await engine.getConversation('conv_101');
  assert.equal(fetched.conversationId, 'conv_101');
  assert.equal(fetched.title, 'New Chat');

  // 3. Update externalChatId on navigation
  const updated = await engine.updateConversation('conv_101', {
    externalChatId: 'chat_uuid_abc',
    identityStatus: 'resolved'
  });
  assert.equal(updated.externalChatId, 'chat_uuid_abc');
  assert.equal(updated.identityStatus, 'resolved');
  assert.equal(updated.completenessStatus, 'head_only', 'identity resolution must not mark completeness as complete');

  // 4. Query by externalChatId index
  const byExternal = await engine.getConversationByExternalId('chat_uuid_abc');
  assert.ok(byExternal, 'Should find conversation by externalChatId');
  assert.equal(byExternal.conversationId, 'conv_101');

  // 5. List conversations ordered by activity
  await engine.createConversation({ conversationId: 'conv_102', title: 'Second Chat' });
  const list = await engine.listConversations();
  assert.equal(list.length, 2);

  engine.close();
});

test('db_crud: message creation updates conversation accounting and tracks monotonic sequences', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_crud_msg' });

  await engine.createConversation({ conversationId: 'conv_200', title: 'Accounting Test' });

  // 1. Insert prompt message
  const msg1 = await engine.createMessage({
    messageId: 'msg_1',
    conversationId: 'conv_200',
    role: 'user',
    segmentId: 0,
    turnSequence: 0,
    content: 'Write a quicksort in C'
  });
  assert.equal(msg1.messageId, 'msg_1');
  assert.equal(msg1.characterCount, 22);
  assert.ok(msg1.contentHash, 'Content hash must be computed');
  assert.equal(msg1.revisionNumber, 1);

  // Verify conversation accounting updated atomically
  const convAfter1 = await engine.getConversation('conv_200');
  assert.equal(convAfter1.messageCount, 1);
  assert.equal(convAfter1.totalCharacterCount, 22);
  assert.equal(convAfter1.lastCapturedMessageId, 'msg_1');
  assert.equal(convAfter1.estimatedSizeBytes, 128 + (22 * 2 + 128));

  // 2. Insert assistant response
  const responseText = 'Here is a quicksort implementation in C...';
  await engine.createMessage({
    messageId: 'msg_2',
    conversationId: 'conv_200',
    role: 'assistant',
    segmentId: 0,
    turnSequence: 1,
    content: responseText
  });

  const convAfter2 = await engine.getConversation('conv_200');
  assert.equal(convAfter2.messageCount, 2);
  assert.equal(convAfter2.totalCharacterCount, 22 + responseText.length);
  assert.equal(convAfter2.lastCapturedMessageId, 'msg_2');

  // Fetch messages
  const messages = await engine.getMessagesByConversation('conv_200');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].turnSequence, 0);
  assert.equal(messages[1].turnSequence, 1);

  engine.close();
});

test('db_crud: segmented sequence compound uniqueness prevents collisions within same segment', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_unique_segment' });

  await engine.createConversation({ conversationId: 'conv_300', title: 'Segment Collision Test' });

  // Add Turn (segment 0, turn 0)
  await engine.createMessage({
    messageId: 'msg_seg0_turn0',
    conversationId: 'conv_300',
    role: 'user',
    segmentId: 0,
    turnSequence: 0,
    content: 'Initial Prompt'
  });

  // Attempting to add duplicate (segment 0, turn 0) must throw a constraint error!
  await assert.rejects(
    async () => {
      await engine.createMessage({
        messageId: 'msg_seg0_turn0_duplicate',
        conversationId: 'conv_300',
        role: 'user',
        segmentId: 0,
        turnSequence: 0,
        content: 'Colliding Turn'
      });
    },
    (err) => {
      assert.equal(err.name, 'StorageError');
      assert.ok(err.code === 'CONSTRAINT_ERROR' || err.code === 'TRANSACTION_ERROR');
      return true;
    }
  );

  // Accounting must remain 1 message (transaction rollback on collision)
  const conv = await engine.getConversation('conv_300');
  assert.equal(conv.messageCount, 1);

  engine.close();
});

test('db_crud: non-unique sequence index allows identical turnSequence in different segments', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_cross_segment' });

  await engine.createConversation({ conversationId: 'conv_400', title: 'Discontinuous Segment Test' });

  // Segment 0, Turn 0
  await engine.createMessage({
    messageId: 'msg_seg0',
    conversationId: 'conv_400',
    role: 'user',
    segmentId: 0,
    turnSequence: 0,
    content: 'Turn in Segment 0'
  });

  // Segment 1, Turn 0 (representing unanchored gap / discontinuous capture)
  // Must succeed because (conv_400, 1, 0) != (conv_400, 0, 0)!
  const msgSeg1 = await engine.createMessage({
    messageId: 'msg_seg1',
    conversationId: 'conv_400',
    role: 'user',
    segmentId: 1,
    turnSequence: 0,
    orderConfidence: 'gap_discontinuous',
    content: 'Turn in Segment 1 after virtualization gap'
  });
  assert.equal(msgSeg1.segmentId, 1);
  assert.equal(msgSeg1.turnSequence, 0);

  // Both messages must be retrieved
  const allMessages = await engine.getMessagesByConversation('conv_400');
  assert.equal(allMessages.length, 2);
  assert.equal(allMessages[0].segmentId, 0);
  assert.equal(allMessages[1].segmentId, 1);

  // Querying specifically segment 1
  const seg1Only = await engine.getMessagesByConversation('conv_400', { segmentId: 1 });
  assert.equal(seg1Only.length, 1);
  assert.equal(seg1Only[0].messageId, 'msg_seg1');

  engine.close();
});

test('db_crud: repeated text in distinct messages are preserved with separate identities', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_repeated_text' });

  await engine.createConversation({ conversationId: 'conv_500', title: 'Repeated Text Test' });

  // User repeatedly says "continue"
  const m1 = await engine.createMessage({
    messageId: 'msg_rep_1',
    conversationId: 'conv_500',
    role: 'user',
    segmentId: 0,
    turnSequence: 0,
    content: 'continue'
  });

  const m2 = await engine.createMessage({
    messageId: 'msg_rep_2',
    conversationId: 'conv_500',
    role: 'user',
    segmentId: 0,
    turnSequence: 1,
    content: 'continue'
  });

  assert.equal(m1.contentHash, m2.contentHash, 'Content hashes are identical');
  assert.notEqual(m1.messageId, m2.messageId, 'Message IDs must remain distinct');
  assert.notEqual(m1.turnSequence, m2.turnSequence, 'Sequences must be distinct');

  const messages = await engine.getMessagesByConversation('conv_500');
  assert.equal(messages.length, 2, 'Both distinct messages must be preserved');

  engine.close();
});

test('db_crud: in-place message revision updates text, increments revision, and marks memory stale', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_revision' });

  await engine.createConversation({ conversationId: 'conv_600', title: 'Revision Test' });

  // Initial message
  const orig = await engine.createMessage({
    messageId: 'msg_rev_1',
    conversationId: 'conv_600',
    role: 'assistant',
    segmentId: 0,
    turnSequence: 0,
    content: 'Draft 1: Original text with typo'
  });
  assert.equal(orig.revisionNumber, 1);

  // Set memory to ready
  await engine.setConversationMemory({
    conversationId: 'conv_600',
    compactSummary: 'Summary of draft 1',
    status: 'ready'
  });

  // Regenerate assistant reply (in-place replacement)
  const newText = 'Draft 2: Regenerated polished response without typo';
  const revised = await engine.updateMessageContent('msg_rev_1', newText);

  assert.equal(revised.content, newText);
  assert.equal(revised.revisionNumber, 2);
  assert.ok(revised.auditMetadata, 'Audit metadata must be recorded');
  assert.equal(revised.auditMetadata.previousContentHash, orig.contentHash);
  assert.equal(revised.auditMetadata.revisionCount, 2);

  // Check conversation character counts adjusted
  const conv = await engine.getConversation('conv_600');
  const expectedChars = newText.length + 'Summary of draft 1'.length;
  assert.equal(conv.totalCharacterCount, expectedChars);

  // Verify memory status is marked stale
  const mem = await engine.getConversationMemory('conv_600');
  assert.equal(mem.status, 'stale', 'Memory must be marked stale on revision');

  engine.close();
});

test('db_crud: cascade deletion of conversation erases messages and memory atomically', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_cascade' });

  await engine.createConversation({ conversationId: 'conv_700', title: 'Cascade Test' });
  await engine.createMessage({
    messageId: 'm701',
    conversationId: 'conv_700',
    role: 'user',
    content: 'Delete me'
  });
  await engine.setConversationMemory({
    conversationId: 'conv_700',
    compactSummary: 'Memory to delete',
    status: 'ready'
  });

  // Cascade delete
  const del = await engine.deleteConversation('conv_700');
  assert.equal(del.deleted, true);

  // Verify conversation is gone
  assert.equal(await engine.getConversation('conv_700'), null);
  // Verify message is gone
  assert.equal(await engine.getMessage('m701'), null);
  // Verify memory is gone
  assert.equal(await engine.getConversationMemory('conv_700'), null);

  engine.close();
});

test('db_crud: global storage accounting aggregates counts and repair restores exact totals', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_accounting' });

  await engine.createConversation({ conversationId: 'c1', title: 'Chat 1' });
  await engine.createMessage({ messageId: 'm1', conversationId: 'c1', role: 'user', turnSequence: 0, content: '12345' }); // 5 chars
  await engine.createMessage({ messageId: 'm2', conversationId: 'c1', role: 'assistant', turnSequence: 1, content: '1234567890' }); // 10 chars

  const stats = await engine.getStorageAccounting();
  assert.equal(stats.conversationCount, 1);
  assert.equal(stats.totalMessageCount, 2);
  assert.equal(stats.totalCharacterCount, 15);

  // Test repair function
  const repaired = await engine.repairConversationAccounting('c1');
  assert.equal(repaired.messageCount, 2);
  assert.equal(repaired.totalCharacterCount, 15);

  engine.close();
});

test('db_crud: rejects invalid records with StorageError VALIDATION_ERROR', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_validation' });

  // 1. Missing conversationId
  await assert.rejects(
    async () => { await engine.createConversation({ platform: 'chatgpt' }); },
    (err) => err.code === 'VALIDATION_ERROR'
  );

  // 2. Unsupported platform
  await assert.rejects(
    async () => { await engine.createConversation({ conversationId: 'c_bad', platform: 'unsupported_platform' }); },
    (err) => err.code === 'VALIDATION_ERROR'
  );

  // 3. Invalid role
  await assert.rejects(
    async () => { await engine.createMessage({ messageId: 'm_bad', conversationId: 'c1', role: 'system', content: 'hi' }); },
    (err) => err.code === 'VALIDATION_ERROR'
  );

  // 4. Negative turnSequence
  await assert.rejects(
    async () => { await engine.createMessage({ messageId: 'm_bad2', conversationId: 'c1', role: 'user', content: 'hi', turnSequence: -1 }); },
    (err) => err.code === 'VALIDATION_ERROR'
  );

  engine.close();
});
