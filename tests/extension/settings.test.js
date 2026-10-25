const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');
const read = (p) => fs.readFileSync(p, 'utf8');

const { WDAIDT_CONFIG, wdaidtGeminiUrl } = require(path.join(ext, 'src', 'shared', 'config.js'));

test('settings: HTML markup contains all required API key and Mock Mode controls', () => {
  const html = read(path.join(ext, 'src', 'sidepanel', 'index.html'));

  assert.ok(html.includes('id="apiKeyInput"'), 'missing #apiKeyInput');
  assert.ok(html.includes('type="password"'), 'apiKeyInput must default to password masking');
  assert.ok(html.includes('id="apiKeyToggleBtn"'), 'missing #apiKeyToggleBtn');
  assert.ok(html.includes('id="apiKeyClearBtn"'), 'missing #apiKeyClearBtn');
  assert.ok(html.includes('id="apiKeyStatus"'), 'missing #apiKeyStatus');
  assert.ok(html.includes('id="mockModeToggle"'), 'missing #mockModeToggle');
  assert.ok(html.includes('aistudio.google.com'), 'missing link to Google AI Studio for key generation');
});

test('settings: HTML loads all shared modules before app.js', () => {
  const html = read(path.join(ext, 'src', 'sidepanel', 'index.html'));

  const scripts = [
    'src="../shared/messages.js"',
    'src="../shared/config.js"',
    'src="../shared/prompts.js"',
    'src="../shared/validator.js"',
    'src="../shared/mock-analyzer.js"',
    'src="../shared/gemini-client.js"',
    'src="app.js"'
  ];

  let lastIndex = -1;
  for (const s of scripts) {
    const idx = html.indexOf(s);
    assert.ok(idx !== -1, `missing script tag: ${s}`);
    assert.ok(idx > lastIndex, `script ${s} loaded out of order`);
    lastIndex = idx;
  }
});

test('settings: manifest.json declares generous permissions for Generative Language API', () => {
  const m = JSON.parse(read(path.join(ext, 'manifest.json')));
  assert.ok(Array.isArray(m.host_permissions), 'host_permissions must be an array');
  assert.ok(
    m.host_permissions.includes('https://generativelanguage.googleapis.com/*'),
    'manifest.json missing host_permission for Google Gemini REST API'
  );
});

test('settings: config provides centralized Gemini parameters and storage keys', () => {
  assert.equal(WDAIDT_CONFIG.GEMINI_BASE_URL, 'https://generativelanguage.googleapis.com/v1beta');
  assert.equal(WDAIDT_CONFIG.GEMINI_DEFAULT_MODEL, 'gemini-3.5-flash-lite');
  assert.ok(Array.isArray(WDAIDT_CONFIG.GEMINI_FALLBACK_MODELS));
  assert.ok(WDAIDT_CONFIG.GEMINI_FALLBACK_MODELS.includes('gemini-3.5-flash-lite'));
  assert.ok(WDAIDT_CONFIG.GEMINI_FALLBACK_MODELS.includes('gemini-flash-latest'));
  assert.ok(WDAIDT_CONFIG.GEMINI_FALLBACK_MODELS.includes('gemini-3.8-flash'));

  assert.equal(WDAIDT_CONFIG.STORAGE_KEYS.API_KEY, 'wdaidt_gemini_api_key');
  assert.equal(WDAIDT_CONFIG.STORAGE_KEYS.MOCK_MODE, 'wdaidt_mock_mode');
});

test('settings: wdaidtGeminiUrl constructs proper endpoint URL', () => {
  const defaultUrl = wdaidtGeminiUrl();
  assert.equal(
    defaultUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent'
  );

  const customUrl = wdaidtGeminiUrl('gemini-3.8-flash');
  assert.equal(
    customUrl,
    'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent'
  );
});
