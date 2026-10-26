/**
 * @file db_transactions.test.js
 * @description Focused regression tests verifying IndexedDB transaction completion
 * ordering, multi-store rollback atomicity, compound constraint safety, and
 * accounting lifecycle consistency.
 *
 * NOTE ON TEST ENVIRONMENT & EVIDENCE:
 * These unit tests execute in headless Node.js using the hermetic in-memory mock harness
 * defined in `tests/extension/fixtures/mock_idb.js`. They verify the transactional
 * state machine, callback dispatch ordering, and rollback logic in `db.js`.
 * They do NOT assert browser vendor-specific C++ IndexedDB runtime behaviors,
 * which require headless browser integration tests (e.g., Playwright / Puppeteer).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMockIndexedDB } = require('./fixtures/mock_idb.js');
const { WDAIDT_DB } = require('../../extension/src/shared/db.js');

test('db_transactions: transaction completion ordering guarantees resolve occurs after tx.oncomplete', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_tx_ordering' });

  // Open database connection first
  const db = await engine.open();

  // Intercept db.transaction to monitor tx.oncomplete vs promise resolution
  const events = [];
  const origTransaction = db.transaction.bind(db);
  db.transaction = (...txArgs) => {
    const tx = origTransaction(...txArgs);
    let assignedOnComplete = null;
    Object.defineProperty(tx, 'oncomplete', {
      configurable: true,
      get() {
        return assignedOnComplete;
      },
      set(fn) {
        assignedOnComplete = (evt) => {
          events.push('tx.oncomplete');
          if (typeof fn === 'function') fn(evt);
        };
      }
    });
    return tx;
  };

  const created = await engine.createConversation({ conversationId: 'c_order', title: 'Order Test' });
  events.push('operation.resolved');

  // Verify operation resolved strictly AFTER tx.oncomplete fired
  assert.deepEqual(events, ['tx.oncomplete', 'operation.resolved']);
  assert.equal(created.conversationId, 'c_order');

  engine.close();
});

test('db_transactions: aborted multi-store writes leave every store unchanged (Rollback Atomicity)', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_tx_abort' });

  // Baseline conversation
  await engine.createConversation({ conversationId: 'c_base', title: 'Base Conversation' });

  // Attempt an operation spanning conversations, messages, and memory that aborts midway
  const STORES = WDAIDT_DB.STORES;
  await assert.rejects(
    async () => {
      // Direct raw transaction test to simulate a failure midway through multi-store write
      const db = await engine.open();
      const tx = db.transaction([STORES.CONVERSATIONS, STORES.MESSAGES, STORES.MEMORY], 'readwrite');
      const convStore = tx.objectStore(STORES.CONVERSATIONS);
      const msgStore = tx.objectStore(STORES.MESSAGES);
      const memStore = tx.objectStore(STORES.MEMORY);

      // 1. Stage a conversation edit in transaction snapshot
      convStore.put({ conversationId: 'c_base', title: 'Mutated in Snapshot', messageCount: 99 });

      // 2. Stage a message
      msgStore.add({
        messageId: 'm_aborted',
        conversationId: 'c_base',
        role: 'user',
        segmentId: 0,
        turnSequence: 0,
        content: 'Ghost message'
      });

      // 3. Stage memory
      memStore.put({
        conversationId: 'c_base',
        compactSummary: 'Ghost summary'
      });

      // 4. Force abort
      tx.abort();

      await new Promise((resolve, reject) => {
        tx.onabort = () => reject(new Error('MANUAL_ABORT'));
        tx.onerror = () => reject(tx.error);
        tx.oncomplete = () => resolve();
      });
    },
    /AbortError|MANUAL_ABORT/
  );

  // VERIFY: All stores remain strictly identical to pre-transaction baseline
  const conv = await engine.getConversation('c_base');
  assert.equal(conv.title, 'Base Conversation', 'Conversation title must not be mutated');
  assert.equal(conv.messageCount, 0, 'Conversation messageCount must not be mutated');

  const msg = await engine.getMessage('m_aborted');
  assert.equal(msg, null, 'Message must not exist after aborted transaction');

  const mem = await engine.getConversationMemory('c_base');
  assert.equal(mem, null, 'Memory must not exist after aborted transaction');

  engine.close();
});

test('db_transactions: unique compound-index violations leave messages and conversation accounting unchanged', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_constraint_rollback' });

  await engine.createConversation({ conversationId: 'c_constraint', title: 'Constraint Safety Test' });

  // Valid message 1 at (c_constraint, 0, 0)
  const m1 = await engine.createMessage({
    messageId: 'msg_initial',
    conversationId: 'c_constraint',
    role: 'user',
    segmentId: 0,
    turnSequence: 0,
    content: '12345' // 5 chars
  });
  assert.equal(m1.characterCount, 5);

  const baselineConv = await engine.getConversation('c_constraint');
  assert.equal(baselineConv.messageCount, 1);
  assert.equal(baselineConv.totalCharacterCount, 5);
  const baselineBytes = baselineConv.estimatedSizeBytes;

  // Attempt duplicate insert at the exact same compound key (c_constraint, 0, 0)
  await assert.rejects(
    async () => {
      await engine.createMessage({
        messageId: 'msg_colliding',
        conversationId: 'c_constraint',
        role: 'user',
        segmentId: 0,
        turnSequence: 0, // COLLISION with msg_initial!
        content: 'This is a large colliding message that would distort accounting if not rolled back'
      });
    },
    (err) => {
      assert.equal(err.code, 'CONSTRAINT_ERROR');
      return true;
    }
  );

  // VERIFY: Colliding message was not persisted
  const collidingMsg = await engine.getMessage('msg_colliding');
  assert.equal(collidingMsg, null, 'Colliding message must not be stored');

  // VERIFY: Conversation accounting was NOT altered
  const convAfterCollision = await engine.getConversation('c_constraint');
  assert.equal(convAfterCollision.messageCount, 1, 'messageCount must remain 1');
  assert.equal(convAfterCollision.totalCharacterCount, 5, 'totalCharacterCount must remain 5');
  assert.equal(convAfterCollision.estimatedSizeBytes, baselineBytes, 'estimatedSizeBytes must remain unchanged');
  assert.equal(convAfterCollision.lastCapturedMessageId, 'msg_initial', 'lastCapturedMessageId must remain msg_initial');

  engine.close();
});

test('db_transactions: accounting lifecycle consistency across insert, revision, memory update, delete, and repair', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_accounting_lifecycle' });

  const OVERHEAD = WDAIDT_DB.RECORD_METADATA_OVERHEAD_BYTES; // 128 bytes

  // 1. Initial conversation
  const c = await engine.createConversation({ conversationId: 'c_cycle', title: 'Accounting Lifecycle' });
  assert.equal(c.messageCount, 0);
  assert.equal(c.totalCharacterCount, 0);
  assert.equal(c.estimatedSizeBytes, OVERHEAD);

  // 2. Insert Message 1 (10 chars)
  // expected size = OVERHEAD (128) + (10 * 2 + 128) = 276
  await engine.createMessage({
    messageId: 'm1',
    conversationId: 'c_cycle',
    role: 'user',
    segmentId: 0,
    turnSequence: 0,
    content: '0123456789' // 10 chars
  });
  let conv = await engine.getConversation('c_cycle');
  assert.equal(conv.messageCount, 1);
  assert.equal(conv.totalCharacterCount, 10);
  assert.equal(conv.estimatedSizeBytes, 276);

  // 3. Insert Message 2 (20 chars)
  // expected size = 276 + (20 * 2 + 128) = 444
  await engine.createMessage({
    messageId: 'm2',
    conversationId: 'c_cycle',
    role: 'assistant',
    segmentId: 0,
    turnSequence: 1,
    content: '01234567890123456789' // 20 chars
  });
  conv = await engine.getConversation('c_cycle');
  assert.equal(conv.messageCount, 2);
  assert.equal(conv.totalCharacterCount, 30);
  assert.equal(conv.estimatedSizeBytes, 444);

  // 4. Update Conversation Memory (30 chars summary)
  // totalCharacterCount MUST REMAIN 30 (strictly counts message content)
  // estimatedSizeBytes incorporates memory record: 444 + (30 * 2 + 128) = 632
  await engine.setConversationMemory({
    conversationId: 'c_cycle',
    compactSummary: '123456789012345678901234567890', // 30 chars
    status: 'ready'
  });
  conv = await engine.getConversation('c_cycle');
  assert.equal(conv.messageCount, 2, 'Memory update must not change messageCount');
  assert.equal(conv.totalCharacterCount, 30, 'Memory update must not alter message totalCharacterCount');
  assert.equal(conv.estimatedSizeBytes, 632, 'estimatedSizeBytes must incorporate memory record footprint');

  // 5. In-place Message Revision: update m2 from 20 chars to 40 chars (+20 chars)
  // totalCharacterCount = 30 + 20 = 50
  // estimatedSizeBytes = 632 + (20 chars * 2 bytes) = 672
  const revisedContent = '0123456789012345678901234567890123456789'; // 40 chars
  await engine.updateMessageContent('m2', revisedContent);
  conv = await engine.getConversation('c_cycle');
  assert.equal(conv.messageCount, 2);
  assert.equal(conv.totalCharacterCount, 50);
  assert.equal(conv.estimatedSizeBytes, 672);

  // 6. Authoritative Repair verification: must match exact totals
  const repaired1 = await engine.repairConversationAccounting('c_cycle');
  assert.equal(repaired1.messageCount, 2);
  assert.equal(repaired1.totalCharacterCount, 50);
  assert.equal(repaired1.estimatedSizeBytes, 672);

  // 7. Delete Message 1 (10 chars, footprint = 10 * 2 + 128 = 148 bytes)
  // messageCount = 1
  // totalCharacterCount = 50 - 10 = 40
  // estimatedSizeBytes = 672 - 148 = 524
  const del = await engine.deleteMessage('m1');
  assert.equal(del.deleted, true);
  conv = await engine.getConversation('c_cycle');
  assert.equal(conv.messageCount, 1);
  assert.equal(conv.totalCharacterCount, 40);
  assert.equal(conv.estimatedSizeBytes, 524);

  // 8. Repair after deletion must also match to the exact byte
  const repaired2 = await engine.repairConversationAccounting('c_cycle');
  assert.equal(repaired2.messageCount, 1);
  assert.equal(repaired2.totalCharacterCount, 40);
  assert.equal(repaired2.estimatedSizeBytes, 524);

  // 9. Global accounting aggregation
  const globalStats = await engine.getStorageAccounting();
  assert.equal(globalStats.conversationCount, 1);
  assert.equal(globalStats.totalMessageCount, 1);
  assert.equal(globalStats.totalCharacterCount, 40);
  assert.equal(globalStats.estimatedStorageBytes, 524);

  engine.close();
});
