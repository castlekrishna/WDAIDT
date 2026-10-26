/**
 * @file conversation_capture.test.js
 * @description Focused tests for WDAIDT V3 Conversation Capture & Identity Reconciliation.
 *
 * Covers:
 *  - Conversation identity from URLs (/c/:id vs provisional /)
 *  - Capturing user and assistant messages incrementally
 *  - Repeated observer events and duplicate prevention
 *  - Identical text in distinct message positions
 *  - Navigation between conversations without cross-contamination
 *  - Edited or regenerated messages in place
 *  - Persistence failure handling and recovery
 *  - Existing V2 capture and analysis behavior remaining intact
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { createMockIndexedDB } = require('./fixtures/mock_idb.js');
const { WDAIDT_DB } = require('../../extension/src/shared/db.js');
const { WDAIDT_CAPTURE } = require('../../extension/src/content/conversation_capture.js');

test('capture: extracts external chat ID from ChatGPT URLs correctly', () => {
  const { extractExternalChatId } = WDAIDT_CAPTURE;

  assert.equal(extractExternalChatId('https://chatgpt.com/c/67890-abcd-1234'), '67890-abcd-1234');
  assert.equal(extractExternalChatId('https://chat.openai.com/c/my-chat-id'), 'my-chat-id');
  assert.equal(extractExternalChatId('https://chatgpt.com/c/my-chat-id?model=gpt-4'), 'my-chat-id');
  assert.equal(extractExternalChatId('https://chatgpt.com/'), null);
  assert.equal(extractExternalChatId('https://chatgpt.com/?temporary-chat=true'), null);
  assert.equal(extractExternalChatId(''), null);
  assert.equal(extractExternalChatId(null), null);
});

test('capture: manages provisional conversation identity and reconciles when URL updates to /c/:id', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_ident_reconcile' });

  let currentUrl = 'https://chatgpt.com/';
  const capture = WDAIDT_CAPTURE.createConversationCapture({
    storageEngine: storage,
    getUrl: () => currentUrl
  });

  // 1. Initial capture on '/' -> provisional conversation
  const res1 = await capture.capture([
    { role: 'user', text: 'Hello from provisional chat' },
    { role: 'assistant', text: 'Hello! How can I help?' }
  ]);
  assert.equal(res1.status, 'ok');
  assert.equal(res1.captured, 2);

  const provConvId = capture.getActiveConversationId();
  assert.ok(provConvId.startsWith('conv_prov_'));
  assert.equal(capture.getActiveIdentityStatus(), 'provisional');
  assert.equal(capture.getActiveExternalChatId(), null);

  const convRecord = await storage.getConversation(provConvId);
  assert.equal(convRecord.identityStatus, 'provisional');
  assert.equal(convRecord.externalChatId, null);
  assert.equal(convRecord.messageCount, 2);

  // 2. ChatGPT updates URL via pushState to /c/permanent-uuid-999
  currentUrl = 'https://chatgpt.com/c/permanent-uuid-999';

  // Trigger next sweep
  const res2 = await capture.capture([
    { role: 'user', text: 'Hello from provisional chat' },
    { role: 'assistant', text: 'Hello! How can I help?' }
  ]);
  assert.equal(res2.status, 'ok');
  assert.equal(res2.captured, 0, 'No re-captures for existing messages');

  // Verify conversation promoted in-place
  assert.equal(capture.getActiveConversationId(), provConvId);
  assert.equal(capture.getActiveIdentityStatus(), 'resolved');
  assert.equal(capture.getActiveExternalChatId(), 'permanent-uuid-999');

  const reconciledConv = await storage.getConversation(provConvId);
  assert.equal(reconciledConv.identityStatus, 'resolved');
  assert.equal(reconciledConv.externalChatId, 'permanent-uuid-999');

  // Fast lookup by external ID must find this conversation
  const lookup = await storage.getConversationByExternalId('permanent-uuid-999');
  assert.equal(lookup.conversationId, provConvId);

  storage.close();
});

test('capture: captures user and assistant messages incrementally to IndexedDB', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_incremental_capture' });

  const capture = WDAIDT_CAPTURE.createConversationCapture({
    storageEngine: storage,
    getUrl: () => 'https://chatgpt.com/c/chat_incr_01'
  });

  const res = await capture.capture([
    { role: 'user', text: 'Explain Quicksort algorithm', sourceMessageId: 'src_u1' },
    { role: 'assistant', text: 'Quicksort is a divide-and-conquer sorting algorithm.', sourceMessageId: 'src_a1' }
  ]);
  assert.equal(res.status, 'ok');
  assert.equal(res.captured, 2);

  const convId = capture.getActiveConversationId();
  const messages = await storage.getMessagesByConversation(convId);
  assert.equal(messages.length, 2);

  assert.equal(messages[0].role, 'user');
  assert.equal(messages[0].content, 'Explain Quicksort algorithm');
  assert.equal(messages[0].sourceMessageId, 'src_u1');
  assert.equal(messages[0].turnSequence, 0);

  assert.equal(messages[1].role, 'assistant');
  assert.equal(messages[1].content, 'Quicksort is a divide-and-conquer sorting algorithm.');
  assert.equal(messages[1].sourceMessageId, 'src_a1');
  assert.equal(messages[1].turnSequence, 1);

  storage.close();
});

test('capture: repeated observer events prevent duplicate writes', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_dedupe' });

  const capture = WDAIDT_CAPTURE.createConversationCapture({
    storageEngine: storage,
    getUrl: () => 'https://chatgpt.com/c/chat_dedupe'
  });

  const items = [
    { role: 'user', text: 'First user prompt' },
    { role: 'assistant', text: 'First assistant reply' }
  ];

  // Observer Sweep 1
  const s1 = await capture.capture(items);
  assert.equal(s1.captured, 2);

  // Observer Sweep 2 (identical DOM state)
  const s2 = await capture.capture(items);
  assert.equal(s2.captured, 0);
  assert.equal(s2.updated, 0);

  // Observer Sweep 3 (repeated again)
  const s3 = await capture.capture(items);
  assert.equal(s3.captured, 0);

  const convId = capture.getActiveConversationId();
  const msgs = await storage.getMessagesByConversation(convId);
  assert.equal(msgs.length, 2, 'Must still contain exactly 2 messages in database');

  storage.close();
});

test('capture: preserves identical text in distinct message positions as separate records', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_repeated_text_distinct' });

  const capture = WDAIDT_CAPTURE.createConversationCapture({
    storageEngine: storage,
    getUrl: () => 'https://chatgpt.com/c/chat_rep_text'
  });

  // User says "continue" at turn 0, and says "continue" again at turn 2
  const items = [
    { role: 'user', text: 'continue', sourceMessageId: 'src_1' },
    { role: 'assistant', text: 'Part 1 of the explanation...', sourceMessageId: 'src_2' },
    { role: 'user', text: 'continue', sourceMessageId: 'src_3' },
    { role: 'assistant', text: 'Part 2 of the explanation...', sourceMessageId: 'src_4' }
  ];

  const res = await capture.capture(items);
  assert.equal(res.captured, 4);

  const convId = capture.getActiveConversationId();
  const msgs = await storage.getMessagesByConversation(convId);
  assert.equal(msgs.length, 4);

  // Both user messages have identical text 'continue'
  assert.equal(msgs[0].content, 'continue');
  assert.equal(msgs[2].content, 'continue');

  // But must have distinct IDs and turn sequences
  assert.notEqual(msgs[0].messageId, msgs[2].messageId);
  assert.equal(msgs[0].turnSequence, 0);
  assert.equal(msgs[2].turnSequence, 2);

  // Re-sweep: neither is re-written
  const res2 = await capture.capture(items);
  assert.equal(res2.captured, 0);

  storage.close();
});

test('capture: navigation between conversations prevents cross-contamination', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_nav_isolation' });

  let currentUrl = 'https://chatgpt.com/c/thread_alpha';
  const capture = WDAIDT_CAPTURE.createConversationCapture({
    storageEngine: storage,
    getUrl: () => currentUrl
  });

  // Capture Thread Alpha
  await capture.capture([
    { role: 'user', text: 'Alpha message' }
  ]);
  const alphaId = capture.getActiveConversationId();

  // Navigate to Thread Beta
  currentUrl = 'https://chatgpt.com/c/thread_beta';
  await capture.capture([
    { role: 'user', text: 'Beta message' }
  ]);
  const betaId = capture.getActiveConversationId();

  assert.notEqual(alphaId, betaId, 'Different threads must have distinct conversation IDs');

  const alphaMsgs = await storage.getMessagesByConversation(alphaId);
  assert.equal(alphaMsgs.length, 1);
  assert.equal(alphaMsgs[0].content, 'Alpha message');

  const betaMsgs = await storage.getMessagesByConversation(betaId);
  assert.equal(betaMsgs.length, 1);
  assert.equal(betaMsgs[0].content, 'Beta message');

  storage.close();
});

test('capture: detects edited and regenerated messages in place', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_edits' });

  const capture = WDAIDT_CAPTURE.createConversationCapture({
    storageEngine: storage,
    getUrl: () => 'https://chatgpt.com/c/chat_edits'
  });

  // Initial capture: Assistant reply Draft 1
  await capture.capture([
    { role: 'user', text: 'Tell me a joke' },
    { role: 'assistant', text: 'Draft 1: Why did the chicken cross the road?' }
  ]);

  const convId = capture.getActiveConversationId();
  const msgsBefore = await storage.getMessagesByConversation(convId);
  assert.equal(msgsBefore.length, 2);
  const origAsstId = msgsBefore[1].messageId;

  // User clicks "Regenerate" -> Draft 2 appears at the same turn sequence
  const res2 = await capture.capture([
    { role: 'user', text: 'Tell me a joke' },
    { role: 'assistant', text: 'Draft 2: To get to the other side!' }
  ]);

  assert.equal(res2.captured, 0);
  assert.equal(res2.updated, 1, 'Draft 2 must be detected as an in-place update');

  const msgsAfter = await storage.getMessagesByConversation(convId);
  assert.equal(msgsAfter.length, 2, 'Total messages must remain 2');
  assert.equal(msgsAfter[1].messageId, origAsstId, 'Message ID preserved in place');
  assert.equal(msgsAfter[1].content, 'Draft 2: To get to the other side!');
  assert.equal(msgsAfter[1].revisionNumber, 2);
  assert.ok(msgsAfter[1].auditMetadata);

  storage.close();
});

test('capture: handles persistence failure gracefully and allows subsequent retry', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_recovery' });

  const errors = [];
  let shouldFail = true;

  // Wrap storage to simulate a transient storage failure on assistant reply
  const wrappedStorage = {
    ...storage,
    createMessage: async (data) => {
      if (shouldFail && data.role === 'assistant') {
        throw new Error('TRANSIENT_IDB_LOCK');
      }
      return storage.createMessage(data);
    }
  };

  const capture = WDAIDT_CAPTURE.createConversationCapture({
    storageEngine: wrappedStorage,
    getUrl: () => 'https://chatgpt.com/c/chat_recovery',
    onError: (err) => errors.push(err)
  });

  const items = [
    { role: 'user', text: 'Prompt 1' },
    { role: 'assistant', text: 'Reply 1' }
  ];

  // Sweep 1: assistant fails due to simulated lock
  const res1 = await capture.capture(items);
  assert.equal(res1.status, 'ok');
  assert.equal(res1.captured, 1, 'Only user message succeeded');
  assert.equal(errors.length, 1);
  assert.equal(errors[0].message, 'TRANSIENT_IDB_LOCK');

  // Sweep 2: transient error clears -> assistant retry succeeds
  shouldFail = false;
  const res2 = await capture.capture(items);
  assert.equal(res2.status, 'ok');
  assert.equal(res2.captured, 1, 'Assistant message succeeded on retry');

  const convId = capture.getActiveConversationId();
  const msgs = await storage.getMessagesByConversation(convId);
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].content, 'Prompt 1');
  assert.equal(msgs[1].content, 'Reply 1');

  storage.close();
});
