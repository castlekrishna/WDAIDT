# DAY 3 — Lidiya · Extension V0.3 + Capture Reliability Fix

## Delivered
Extension V0.3: robust 5-strategy conversation capture (`extension/src/content/chatgpt.js`) · Auto Analyze trigger on stream completion + debounce · request-ID stale-result guard (`shared/messages.js` + sidebar enforcement) · extension icons (`extension/assets/`, wired in `manifest.json`) · **capture reliability fix: accessibility announcements and UI chrome are no longer captured as conversation text** · 27 extension tests across 3 suites (`node --test`) · Day 3 README checklist complete (4/4).

## Bug Report (fixed)
Sidebar captured a hallucinated interaction:
- Prompt: `Clarify Auto Analyze Request ID` (UI menu text, not a user message)
- Response: `To pick up a draggable item, press the space bar. …` (an accessibility announcement, not the AI answer)

## Root Cause
Two defects in `extension/src/content/chatgpt.js`, confirmed by code inspection and reproduced with DOM fixtures before fixing:
1. `visibleText()` fell back to `textContent` whenever `innerText` was empty — which is exactly the state of hidden accessibility live-regions and `aria-hidden` announcers. Hidden chrome text therefore leaked into captures.
2. `insideExcluded()` filtered forms, links, composer, and landmark elements, but **not** `aria-hidden` subtrees, live regions (`aria-live`, `role="status/alert/log"`), `role="tooltip"`, or `role="menu/menuitem"`. The structural `content-blocks` fallback then paired unrelated chrome texts (menu item + announcement) as prompt/response.

## Implementation Changes (why they resolve it)
- `visibleText()` uses the `textContent` fallback **only when the element is rendered** (new `isRendered()` helper: layout boxes present, not `visibility:hidden`/`display:none`; defaults to rendered when measurement APIs are unavailable so genuine messages are never dropped).
- `insideExcluded()` now also rejects `aria-hidden="true"` subtrees, `role="status/alert/log/tooltip/menu/menuitem/marquee/timer"`, and `aria-live="assertive"` regions — none of which ever contain genuine conversation turns.
- New `insideLive()` guard applied to the weak-signal `content-blocks` strategy only, so polite live-region chatter can never become a turn while attribute-strong strategies (role/message-id/turns/articles) keep working for genuine streaming replies.
- No string-matching of the reported announcement text anywhere: the fix is generic to hidden/live/chrome content.
- Backend API contract unchanged (`POST /analyze` schema, limits, error envelopes all intact).
- Test-harness correction: the `closest()` stub now tests `self` first, matching real DOM semantics (this was masking `role="tooltip/status"` exclusions in tests).

## Files Changed
- `extension/src/content/chatgpt.js` — `isRendered()`, hardened `visibleText()`, extended `insideExcluded()`, new `insideLive()` guard in `findContentBlocks()`.
- `tests/extension/capture.test.js` — stub supports `innerText`-vs-`textContent` + `getClientRects()` + self-matching `closest()`; 6 new tests (bug-report reproduction, genuine-pair priority, aria-hidden exclusion, status-announcer exclusion, no-invented-prompt, dynamic re-read).
- `README.md` — Day 3 reliability notes + corrected test counts/commands.
- `docs/DAY3.md` — this file.

## Test Report (actually executed)
- `node --test tests/extension/capture.test.js tests/extension/auto.test.js tests/extension/day1.smoke.test.js` — **32/32 pass** (5 smoke + 21 capture + 6 auto). The 3 bug-reproduction tests failed before the fix with chrome text captured as prompt/response, and pass after.
- `python -m pytest tests/backend/ -q` — **16/16 pass**, including `test_validation_error_empty_string_422`, `test_validation_error_empty_response_422`, `test_validation_error_missing_fields_422`, which prove invalid/empty captures are rejected with `422 INVALID_REQUEST` before analysis.
- `node --check` on changed extension scripts — clean.

## How to Run Extension Tests
```powershell
node --test tests/extension/capture.test.js tests/extension/auto.test.js tests/extension/day1.smoke.test.js
```

## Limitations & Follow-ups
- Closed shadow roots cannot be pierced by design; open ones are searched.
- Cross-origin iframes are not searched (`all_frames: false`); ChatGPT renders the thread in the main frame.
- `content-blocks` alternation assumes user-first ordering; attribute-strong strategies take precedence wherever markup hooks exist.
- Sidebar `Copy diagnostics` (fingerprint: strategy, role/message-id/turn/article/shadow counts, observed `data-testid`s) remains the escalation path for unseen markup.

## Day 3 Status
Complete per verified results: 4/4 README checklist items + the capture-reliability fix, all covered by passing tests. Manual browser re-verification (reload extension → reload ChatGPT tab → Why?) remains the operator's final step.

## Follow-up: End-to-End Capture + Why? Honesty Hardening

### Bug
Follow-up report: the sidebar could show a prompt echoed as the response, and an unreachable backend produced a locally generated "preview analysis" card that looked like a real result.

### Root Cause (verified by inspection + fixtures)
1. `norm()` collapsed blank lines, so paragraph breaks were lost between capture and display.
2. Backend `is_mock` treated a *missing* API key as mock mode → HTTP 200 with synthetic analysis, indistinguishable from a real one.
3. Sidebar `NETWORK` failures rendered `localPreviewAnalysis()` output as a success card.
4. No structured logging anywhere; only raw outcomes were visible.

### Changes (why)
- `norm()` preserves single/double line breaks (3+ collapse to a paragraph break); `.preview` already renders `pre-wrap`, so paragraphs survive end to end.
- Mock mode is now strictly opt-in (`MOCK_ANALYSIS=true`); a missing key returns `502 AI_PROVIDER_ERROR` naming the key and the mock flag. No code path substitutes prompt text into the response field — pairing is DOM-order based, and partial captures surface `(not captured)`.
- Sidebar shows explicit staged errors (incl. `Can't reach the analysis server`) with Retry re-running the full workflow; `localPreviewAnalysis` deleted.
- Lengths-only logging: sidebar `logEvent` (stage, codes, field lengths — never text) and backend `wdaidt.analyze` logs (`request_id`, `prompt_len`, `response_len`, `latency_ms`, rejection codes).
- API contract unchanged.

### Tests (actually executed)
- New `tests/extension/pipeline.test.js` (4 tests): real content script + real contract constants — distinct multi-paragraph fields with `\n\n` preserved, request-readiness (non-blank, within limits, JSON round-trip, request_id), missing reply never substituted, empty page explicit.
- `tests/backend/test_analyze.py` +4 deterministic tests: explicit mock is derived-not-echoed with length-only logs (caplog), missing key → actionable 502, retry succeeds on 2nd parseable attempt, persistent garbage → 502 after one retry.
- Full suites: extension **39/39**, backend **20/20** (one backend run showed 2 transient live-Gemini 504s on sample tests; both passed on immediate re-run — API latency flake, unrelated to code changes); `node --check` clean.

### Limitations
- No live-browser run available here; pipeline coverage stops at the request payload on the frontend and resumes at endpoint validation on the backend (documented in the pipeline test).
- Identical prompt==response text is not hard-rejected (legitimate echo tasks exist); mis-pairing is prevented structurally instead.
