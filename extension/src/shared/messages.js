/* Shared message types between content script, side panel and service worker.
 * Day 1 (V0.1) scope: only GET_LATEST (+ PING) is wired end-to-end.
 * AUTO_* types are declared now so Day 3 (V0.3) needs no contract change.
 */

const WDAIDT_MESSAGES = Object.freeze({
  // Side panel -> content script: "give me the latest prompt/response pair"
  GET_LATEST: 'WDAIDT_GET_LATEST',
  // Content script -> side panel: payload { prompt, response, onChatGPT, url }
  LATEST_CAPTURED: 'WDAIDT_LATEST_CAPTURED',
  // Reserved for Day 2+ (backend wired analysis trigger)
  ANALYZE_LATEST: 'WDAIDT_ANALYZE_LATEST',
  // Reserved for Day 3 (V0.3 auto analyze)
  AUTO_ANALYZE_ON: 'WDAIDT_AUTO_ANALYZE_ON',
  AUTO_ANALYZE_OFF: 'WDAIDT_AUTO_ANALYZE_OFF',
  // Content script -> side panel (via runtime message): a newly completed
  // exchange settled after streaming. Payload: { prompt, response, url }.
  AUTO_ANALYZE_TRIGGER: 'WDAIDT_AUTO_ANALYZE_TRIGGER',
  ANALYSIS_RESULT: 'WDAIDT_ANALYSIS_RESULT',
  ANALYSIS_ERROR: 'WDAIDT_ANALYSIS_ERROR'
});

// Stale-result guard: drop a backend response whose echoed request_id no
// longer matches the latest request the sidebar issued. Missing ids on
// either side are treated as fresh (never drop what we cannot compare).
function wdaidtIsStaleResult(expectedRequestId, data) {
  if (!expectedRequestId) return false;
  const got = data && data.request_id;
  if (!got) return false;
  return got !== expectedRequestId;
}

// Export for service worker / side panel (non-module scripts share globals).
// Content scripts cannot use ES modules reliably, so we stay on globals.
if (typeof self !== 'undefined') {
  self.WDAIDT_MESSAGES = WDAIDT_MESSAGES;
}
if (typeof globalThis !== 'undefined') {
  globalThis.WDAIDT_MESSAGES = WDAIDT_MESSAGES;
  globalThis.wdaidtIsStaleResult = wdaidtIsStaleResult;
}

// Test hook: plain-script in the browser, require()-able under node.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { WDAIDT_MESSAGES, wdaidtIsStaleResult };
}
