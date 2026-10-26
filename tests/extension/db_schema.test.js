// V3.0.0-alpha.2 IndexedDB Schema & Lifecycle Tests
// Run with: node --test tests/extension/db_schema.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createMockIndexedDB, MockIDBKeyRange } = require('./fixtures/mock_idb.js');
globalThis.IDBKeyRange = MockIDBKeyRange;

const { WDAIDT_DB } = require(path.join(__dirname, '..', '..', 'extension', 'src', 'shared', 'db.js'));

test('db_schema: fresh database initialization creates all documented stores and indexes', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_db_fresh' });

  const db = await engine.open();
  assert.ok(db, 'Database instance should be opened');
  assert.equal(db.version, 1, 'Initial version should be 1');

  // Verify object stores exist
  assert.ok(db.objectStoreNames.contains('conversations'), 'conversations store must exist');
  assert.ok(db.objectStoreNames.contains('messages'), 'messages store must exist');
  assert.ok(db.objectStoreNames.contains('conversation_memory'), 'conversation_memory store must exist');

  // Verify conversations store definition & indexes
  const convTx = db.transaction('conversations', 'readonly');
  const convStore = convTx.objectStore('conversations');
  assert.equal(convStore.keyPath, 'conversationId', 'conversations keyPath must be conversationId');
  assert.ok(convStore.indexNames.contains('by_externalChatId'), 'by_externalChatId index must exist');
  assert.ok(convStore.indexNames.contains('by_lastActivityAt'), 'by_lastActivityAt index must exist');
  assert.ok(convStore.indexNames.contains('by_identityStatus'), 'by_identityStatus index must exist');
  assert.ok(convStore.indexNames.contains('by_completenessStatus'), 'by_completenessStatus index must exist');

  // Verify messages store definition & segmented sequence indexes
  const msgTx = db.transaction('messages', 'readonly');
  const msgStore = msgTx.objectStore('messages');
  assert.equal(msgStore.keyPath, 'messageId', 'messages keyPath must be messageId');
  assert.ok(msgStore.indexNames.contains('by_conversationId'), 'by_conversationId index must exist');
  assert.ok(msgStore.indexNames.contains('by_conv_segment_seq'), 'by_conv_segment_seq index must exist');
  assert.ok(msgStore.indexNames.contains('by_conv_sequence'), 'by_conv_sequence index must exist');
  assert.ok(msgStore.indexNames.contains('by_conv_sourceId'), 'by_conv_sourceId index must exist');
  assert.ok(msgStore.indexNames.contains('by_capturedAt'), 'by_capturedAt index must exist');
  assert.ok(msgStore.indexNames.contains('by_conv_capturedAt'), 'by_conv_capturedAt index must exist');

  // Verify index uniqueness properties per architecture
  const segmentSeqIndex = msgStore.index('by_conv_segment_seq');
  assert.equal(segmentSeqIndex.unique, true, 'by_conv_segment_seq must be unique');
  assert.deepEqual(segmentSeqIndex.keyPath, ['conversationId', 'segmentId', 'turnSequence']);

  const globalSeqIndex = msgStore.index('by_conv_sequence');
  assert.equal(globalSeqIndex.unique, false, 'by_conv_sequence must be non-unique');
  assert.deepEqual(globalSeqIndex.keyPath, ['conversationId', 'turnSequence']);

  // Verify conversation_memory store definition & indexes
  const memTx = db.transaction('conversation_memory', 'readonly');
  const memStore = memTx.objectStore('conversation_memory');
  assert.equal(memStore.keyPath, 'conversationId', 'conversation_memory keyPath must be conversationId');
  assert.ok(memStore.indexNames.contains('by_updatedAt'), 'by_updatedAt index must exist');
  assert.ok(memStore.indexNames.contains('by_status'), 'by_status index must exist');

  engine.close();
});

test('db_schema: reopening an initialized database returns existing connection without re-upgrading', async () => {
  const idb = createMockIndexedDB();
  let upgradeCount = 0;

  const engine1 = WDAIDT_DB.createStorageEngine({
    indexedDB: idb,
    name: 'test_db_reopen',
    onUpgrade: () => { upgradeCount += 1; }
  });
  await engine1.open();
  assert.equal(upgradeCount, 1, 'Initial open should trigger upgrade hook');
  engine1.close();

  // Reopen with engine2
  const engine2 = WDAIDT_DB.createStorageEngine({
    indexedDB: idb,
    name: 'test_db_reopen',
    onUpgrade: () => { upgradeCount += 1; }
  });
  const db2 = await engine2.open();
  assert.ok(db2, 'Reopened DB instance should be valid');
  assert.equal(upgradeCount, 1, 'Reopening at same version must not re-trigger upgrade hook');
  engine2.close();
});

test('db_schema: version upgrade hook is called with old and new versions on version increment', async () => {
  const idb = createMockIndexedDB();
  const versionsObserved = [];

  const engineV1 = WDAIDT_DB.createStorageEngine({
    indexedDB: idb,
    name: 'test_db_upgrade',
    version: 1,
    onUpgrade: (db, oldV, newV) => {
      versionsObserved.push({ oldV, newV });
    }
  });
  await engineV1.open();
  engineV1.close();

  const engineV2 = WDAIDT_DB.createStorageEngine({
    indexedDB: idb,
    name: 'test_db_upgrade',
    version: 2,
    onUpgrade: (db, oldV, newV) => {
      versionsObserved.push({ oldV, newV });
    }
  });
  const dbV2 = await engineV2.open();
  assert.equal(dbV2.version, 2, 'Database version should be incremented to 2');
  assert.deepEqual(versionsObserved, [
    { oldV: 0, newV: 1 },
    { oldV: 1, newV: 2 }
  ]);
  engineV2.close();
});

test('db_schema: reports error when IndexedDB is unavailable in environment', async () => {
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: null });
  await assert.rejects(
    async () => { await engine.open(); },
    (err) => {
      assert.equal(err.name, 'StorageError');
      assert.equal(err.code, 'INDEXEDDB_UNAVAILABLE');
      return true;
    }
  );
});

test('db_schema: deleteDatabase cleanly removes database from factory', async () => {
  const idb = createMockIndexedDB();
  const engine = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_db_delete' });

  await engine.open();
  await engine.createConversation({ conversationId: 'c1', title: 'To Delete' });
  const fetched = await engine.getConversation('c1');
  assert.equal(fetched.title, 'To Delete');

  const res = await engine.deleteDatabase();
  assert.equal(res.deleted, true);

  // Opening after delete creates a fresh database
  const engineNew = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_db_delete' });
  const check = await engineNew.getConversation('c1');
  assert.equal(check, null, 'Deleted database should no longer contain conversation c1');
  engineNew.close();
});
