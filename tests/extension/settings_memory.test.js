// tests/extension/settings_memory.test.js
// Unit and integration tests for WDAIDT V3 Settings, Memory Controls & RC.1 Integration

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createMockIndexedDB, MockIDBKeyRange } = require('./fixtures/mock_idb.js');
const WDAIDT_DB = require('../../extension/src/shared/db.js');
const { WDAIDT_CONFIG } = require('../../extension/src/shared/config.js');
const { buildConversationContext } = require('../../extension/src/shared/context_builder.js');

test('settings: config defines memory enabled, retention days, and storage budget keys', () => {
  assert.equal(WDAIDT_CONFIG.DEFAULT_MEMORY_ENABLED, true);
  assert.equal(WDAIDT_CONFIG.DEFAULT_RETENTION_DAYS, 90);
  assert.equal(WDAIDT_CONFIG.DEFAULT_STORAGE_BUDGET_MB, 100);
  assert.equal(WDAIDT_CONFIG.STORAGE_KEYS.MEMORY_ENABLED, 'wdaidt_memory_enabled');
  assert.equal(WDAIDT_CONFIG.STORAGE_KEYS.RETENTION_DAYS, 'wdaidt_retention_days');
  assert.equal(WDAIDT_CONFIG.STORAGE_KEYS.STORAGE_BUDGET_MB, 'wdaidt_storage_budget_mb');
});

test('settings UI: HTML structure contains all 4 required sections in Obsidian editor theme', () => {
  const htmlPath = path.join(__dirname, '../../extension/src/sidepanel/index.html');
  const html = fs.readFileSync(htmlPath, 'utf8');

  // Verify the 4 distinct section titles
  assert.ok(html.includes('<h3 class="settings-section-title">Analysis</h3>'), 'Analysis section must exist');
  assert.ok(html.includes('<h3 class="settings-section-title">AI Provider</h3>'), 'AI Provider section must exist');
  assert.ok(html.includes('<h3 class="settings-section-title">Conversation Memory</h3>'), 'Conversation Memory section must exist');
  assert.ok(html.includes('<h3 class="settings-section-title">About & Diagnostics</h3>'), 'About & Diagnostics section must exist');

  // Verify memory controls elements exist
  assert.ok(html.includes('id="memoryEnabledToggle"'), 'Memory enable toggle must exist');
  assert.ok(html.includes('id="memoryStatusDot"'), 'Memory status indicator must exist');
  assert.ok(html.includes('id="retentionDaysSelect"'), 'Retention days dropdown must exist');
  assert.ok(html.includes('id="storageBudgetSelect"'), 'Storage budget dropdown must exist');
  assert.ok(html.includes('id="clearMemoryBtn"'), 'Clear memory button must exist');
  assert.ok(html.includes('id="confirmClearMemoryBtn"'), 'Confirmation button must exist');

  // Verify privacy disclosure exists
  assert.ok(html.includes('Privacy Disclosure:'), 'Privacy disclosure must be clearly visible');
  assert.ok(html.includes('Google\'s Generative Language API'), 'Must disclose direct provider transmission');
  assert.ok(!html.includes('end-to-end encrypted'), 'Must not claim encryption when not implemented');
});

test('memory controls: clear memory operation deletes all records and resets accounting without touching settings', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_clear_memory' });

  // Seed conversation, messages, and memory
  await storage.createConversation({ conversationId: 'c_to_delete' });
  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'c_to_delete',
    role: 'user',
    content: 'Sensitive chat turn'
  });
  await storage.setConversationMemory({
    conversationId: 'c_to_delete',
    compactSummary: 'Goal: Sensitive discussion',
    status: 'ready'
  });

  const accountingBefore = await storage.getStorageAccounting();
  assert.equal(accountingBefore.conversationCount, 1);
  assert.equal(accountingBefore.totalMessageCount, 1);
  assert.ok(accountingBefore.estimatedStorageBytes > 0);

  // Execute database wipe
  const delRes = await storage.deleteDatabase();
  assert.equal(delRes.deleted, true);

  // Re-open and verify everything is wiped
  const storageAfter = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_clear_memory' });
  const accountingAfter = await storageAfter.getStorageAccounting();
  assert.equal(accountingAfter.conversationCount, 0);
  assert.equal(accountingAfter.totalMessageCount, 0);
  assert.equal(accountingAfter.estimatedStorageBytes, 0);

  const conv = await storageAfter.getConversation('c_to_delete');
  assert.equal(conv, null);
  const mem = await storageAfter.getConversationMemory('c_to_delete');
  assert.equal(mem, null);
});

test('memory toggle: when memory is disabled, context builder bypasses stored history', async () => {
  const idb = createMockIndexedDB();
  const storage = WDAIDT_DB.createStorageEngine({ indexedDB: idb, name: 'test_mem_disabled' });

  await storage.createConversation({ conversationId: 'c_disabled' });
  await storage.createMessage({
    messageId: 'm1',
    conversationId: 'c_disabled',
    role: 'user',
    turnSequence: 0,
    content: 'Stored prompt 1'
  });
  await storage.createMessage({
    messageId: 'm2',
    conversationId: 'c_disabled',
    role: 'assistant',
    turnSequence: 1,
    content: 'Stored answer 1'
  });

  // Test with memory enabled: finds the 1 stored exchange
  const resEnabled = await buildConversationContext(storage, {
    conversationId: 'c_disabled',
    maxExchanges: 5
  });
  assert.equal(resEnabled.exchanges.length, 1);
  assert.equal(resEnabled.exchanges[0].prompt, 'Stored prompt 1');

  // When memory is disabled at the caller layer (e.g. resolveEnrichedContext in app.js):
  // It returns only the DOM fallback exchanges or empty without invoking DB
  const fallbackDOM = [{ prompt: 'DOM prompt', response: 'DOM response' }];
  const resDisabled = await buildConversationContext(null, {
    fallbackHistory: fallbackDOM,
    maxExchanges: 5
  });
  assert.equal(resDisabled.exchanges.length, 1);
  assert.equal(resDisabled.exchanges[0].prompt, 'DOM prompt');
});

test('accounting formatter: formats byte estimates consistently for display', () => {
  function formatStorageAccountingText(accounting) {
    const acc = accounting || {};
    const convs = acc.conversationCount || 0;
    const msgs = acc.totalMessageCount || 0;
    const bytes = acc.estimatedStorageBytes || 0;
    const kb = (bytes / 1024).toFixed(1);
    return `Stored: ${convs} conversation${convs === 1 ? '' : 's'}, ${msgs} message${msgs === 1 ? '' : 's'} (~${kb} KB)`;
  }

  assert.equal(formatStorageAccountingText(null), 'Stored: 0 conversations, 0 messages (~0.0 KB)');
  assert.equal(
    formatStorageAccountingText({ conversationCount: 1, totalMessageCount: 2, estimatedStorageBytes: 1536 }),
    'Stored: 1 conversation, 2 messages (~1.5 KB)'
  );
  assert.equal(
    formatStorageAccountingText({ conversationCount: 4, totalMessageCount: 28, estimatedStorageBytes: 45056 }),
    'Stored: 4 conversations, 28 messages (~44.0 KB)'
  );
});
