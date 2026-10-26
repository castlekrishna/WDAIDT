/* Single source of truth for extension configuration and API agreement limits.
 * WDAIDT V2.0.1 operates as a self-contained extension with direct Gemini API integration.
 */

const WDAIDT_CONFIG = Object.freeze({
  // Legacy backend connection constants preserved for backward-compatible test fixtures
  BACKEND_BASE_URL: 'http://localhost:8000',
  ANALYZE_PATH: '/analyze',

  // Request timeout: 20s
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
  MAX_CONTEXT_TOTAL_CHARS: 30000,

  // V3.0+ Retention and Storage Budget defaults
  DEFAULT_MEMORY_ENABLED: true,
  DEFAULT_RETENTION_DAYS: 90,
  DEFAULT_STORAGE_BUDGET_MB: 100,

  // V2.0+ Gemini API configuration
  GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',
  GEMINI_DEFAULT_MODEL: 'gemini-3.5-flash-lite',
  GEMINI_FALLBACK_MODELS: [
    'gemini-3.5-flash-lite',
    'gemini-flash-latest',
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite'
  ],
  STORAGE_KEYS: Object.freeze({
    API_KEY: 'wdaidt_gemini_api_key',
    MOCK_MODE: 'wdaidt_mock_mode',
    AUTO_ANALYZE: 'wdaidt_auto_analyze',
    RESPONSE_STYLE: 'wdaidt_response_style',
    CUSTOM_INSTRUCTIONS: 'wdaidt_custom_instructions',
    ANALYSIS_DEPTH: 'wdaidt_analysis_depth',
    CONTEXT_WINDOW: 'wdaidt_context_window',
    MEMORY_ENABLED: 'wdaidt_memory_enabled',
    RETENTION_DAYS: 'wdaidt_retention_days',
    STORAGE_BUDGET_MB: 'wdaidt_storage_budget_mb'
  })
});

function wdaidtGeminiUrl(model, baseUrl) {
  const base = (baseUrl || WDAIDT_CONFIG.GEMINI_BASE_URL).replace(/\/+$/, '');
  const m = String(model || WDAIDT_CONFIG.GEMINI_DEFAULT_MODEL || '').trim().replace(/^models\//, '');
  return `${base}/models/${m}:generateContent`;
}

function wdaidtAnalyzeUrl(baseUrl) {
  const base = (baseUrl || WDAIDT_CONFIG.BACKEND_BASE_URL).replace(/\/+$/, '');
  return base + WDAIDT_CONFIG.ANALYZE_PATH;
}

if (typeof self !== 'undefined') {
  self.WDAIDT_CONFIG = WDAIDT_CONFIG;
  self.wdaidtAnalyzeUrl = wdaidtAnalyzeUrl;
  self.wdaidtGeminiUrl = wdaidtGeminiUrl;
}
if (typeof globalThis !== 'undefined') {
  globalThis.WDAIDT_CONFIG = WDAIDT_CONFIG;
  globalThis.wdaidtAnalyzeUrl = wdaidtAnalyzeUrl;
  globalThis.wdaidtGeminiUrl = wdaidtGeminiUrl;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WDAIDT_CONFIG, wdaidtAnalyzeUrl, wdaidtGeminiUrl };
}
