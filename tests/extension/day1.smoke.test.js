// Day-1 smoke test — no dependencies. Run: node --test tests/extension/
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const ext = path.join(root, 'extension');
const read = (p) => fs.readFileSync(p, 'utf8');

test('manifest.json is valid MV3 with side panel + ChatGPT content script', () => {
  const m = JSON.parse(read(path.join(ext, 'manifest.json')));
  assert.equal(m.manifest_version, 3);
  assert.ok(m.side_panel && m.side_panel.default_path.includes('sidepanel'));
  assert.ok(Array.isArray(m.content_scripts) && m.content_scripts.length);
  const cs = m.content_scripts[0];
  assert.ok(cs.matches.some((s) => s.includes('chatgpt.com')));
  assert.ok(cs.js.some((s) => s.includes('chatgpt.js')));
  // every file referenced by the manifest must exist
  const refs = [
    m.side_panel.default_path,
    m.background.service_worker,
    ...m.content_scripts.flatMap((c) => c.js)
  ];
  for (const r of refs) assert.ok(fs.existsSync(path.join(ext, r)), `missing: ${r}`);
});

test('shared contract declares Day-1 + reserved Day-3 message types', () => {
  const src = read(path.join(ext, 'src', 'shared', 'messages.js'));
  for (const t of ['GET_LATEST', 'ANALYZE_LATEST', 'AUTO_ANALYZE_ON', 'AUTO_ANALYZE_OFF', 'ANALYSIS_RESULT']) {
    assert.ok(src.includes(t), `missing message type ${t}`);
  }
});

test('config pins backend URL + API-agreement limits in one place', () => {
  const src = read(path.join(ext, 'src', 'shared', 'config.js'));
  assert.ok(src.includes('http://localhost:8000'));
  assert.ok(src.includes('/analyze'));
  assert.ok(src.includes('8000')); // MAX_PROMPT_CHARS 8000
  assert.ok(src.includes('20000')); // MAX_RESPONSE_CHARS 20000
  assert.ok(src.includes('20000') && src.includes('FETCH_TIMEOUT_MS'));
});

test('content script captures only (no fetch, no analysis)', () => {
  const src = read(path.join(ext, 'src', 'content', 'chatgpt.js'));
  assert.ok(src.includes('data-message-author-role'));
  assert.ok(src.includes('GET_LATEST'));
  assert.ok(!src.includes('fetch('), 'content script must never call the backend');
  assert.ok(!src.toLowerCase().includes('gemini'), 'no analysis logic in content script');
});

test('side panel has Why?, previews, result sections and safe rendering', () => {
  const html = read(path.join(ext, 'src', 'sidepanel', 'index.html'));
  for (const id of ['whyBtn', 'promptPreview', 'responsePreview', 'whyText', 'influencesList', 'assumptionsList', 'changeList', 'autoToggle']) {
    assert.ok(html.includes(`id="${id}"`), `index.html missing #${id}`);
  }
  const app = read(path.join(ext, 'src', 'sidepanel', 'app.js'));
  assert.ok(app.includes('/analyze') || app.includes('wdaidtAnalyzeUrl'));
  assert.ok(app.includes('textContent'), 'must render as plain text (no HTML injection)');
  assert.ok(app.includes('AbortController'), 'must time out the backend call');
});
