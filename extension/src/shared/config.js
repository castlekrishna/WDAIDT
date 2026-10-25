/* Single source of truth for backend connection + API-agreement limits.
 * Per API agreement: only the side panel / controller calls the backend.
 * The content script never calls this.
 */

const WDAIDT_CONFIG = Object.freeze({
  BACKEND_BASE_URL: 'http://localhost:8000',
  ANALYZE_PATH: '/analyze',
  HEALTH_PATH: '/health',
  // Extension -> backend timeout (agreement: 20s). Backend -> Gemini is 15s.
  FETCH_TIMEOUT_MS: 20000,
  // API agreement size limits: extension trims before sending.
  MAX_PROMPT_CHARS: 8000,
  MAX_RESPONSE_CHARS: 20000,
  // UI preview limits (captured text preview in sidebar, not the API limit).
  PREVIEW_CHARS: 600,

  // V0.6 Response Style presets
  RESPONSE_STYLES: [
    'Friendly and conversational',
    'Lighthearted and witty',
    'Casual and natural',
    'Professional and direct',
    'Formal and precise',
    'Academic and analytical',
    'Custom instructions'
  ],
  DEFAULT_RESPONSE_STYLE: 'Friendly and conversational',

  // V0.6 Analysis Depth presets
  ANALYSIS_DEPTHS: [
    'Brief',
    'Balanced',
    'Detailed'
  ],
  DEFAULT_ANALYSIS_DEPTH: 'Brief',

  // V0.7 Multi-Context Window presets (maximum preceding exchanges)
  CONTEXT_WINDOWS: [
    0,
    3,
    5,
    10
  ],
  DEFAULT_CONTEXT_WINDOW: 5,
  MAX_CONTEXT_EXCHANGES: 10,
  MAX_CONTEXT_TOTAL_CHARS: 30000
});

function wdaidtAnalyzeUrl(baseUrl) {
  const base = (baseUrl || WDAIDT_CONFIG.BACKEND_BASE_URL).replace(/\/+$/, '');
  return base + WDAIDT_CONFIG.ANALYZE_PATH;
}

function wdaidtHealthUrl(baseUrl) {
  const base = (baseUrl || WDAIDT_CONFIG.BACKEND_BASE_URL).replace(/\/+$/, '');
  return base + WDAIDT_CONFIG.HEALTH_PATH;
}

if (typeof self !== 'undefined') {
  self.WDAIDT_CONFIG = WDAIDT_CONFIG;
  self.wdaidtAnalyzeUrl = wdaidtAnalyzeUrl;
  self.wdaidtHealthUrl = wdaidtHealthUrl;
}
if (typeof globalThis !== 'undefined') {
  globalThis.WDAIDT_CONFIG = WDAIDT_CONFIG;
  globalThis.wdaidtAnalyzeUrl = wdaidtAnalyzeUrl;
  globalThis.wdaidtHealthUrl = wdaidtHealthUrl;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WDAIDT_CONFIG, wdaidtAnalyzeUrl, wdaidtHealthUrl };
}
