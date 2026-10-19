# DAY 4 — Multi-Turn SPA Capture Hardening & Dynamic Chat Lifecycle

## Delivered
Full end-to-end reliability for modern ChatGPT Single-Page Application (SPA) interactions (`extension/src/content/chatgpt.js` and `extension/src/sidepanel/app.js`):
- **Multi-turn conversation capture**: Subsequent interactions and continuous back-and-forth turns are reliably extracted without stale prompt leakage or dropped turns.
- **Client-side chat navigation resilience**: Opening new chats or switching between existing conversations dynamically resolves the active chat thread.
- **In-chat survey & disclaimer filtering**: OpenAI feedback prompts (*"Is this conversation helpful so far?"*) and system footers (*"ChatGPT can make mistakes..."*) are cleanly filtered without clipping genuine assistant roadmaps or short user prompts.
- **Fixed-layout SPA container support**: Modern full-screen fixed layout wrappers (`class="fixed inset-0"`) are preserved while overlay popups and tooltips remain excluded.
- **Reliable side panel tab resolution**: `getActiveTab()` queries `lastFocusedWindow` to guarantee targeting the ChatGPT tab even when the Chrome side panel holds active focus.
- **46 extension unit tests passing** (7 new regression suites in `tests/extension/capture.test.js`) + **20 backend tests passing** (`python -m pytest tests/backend/ -q`).
- Verified live in Chrome by operator: *"perfectly working"*.

---

## Issues Addressed & Root Causes

### 1. `RESPONSE_PENDING` on Second Turn or New Chat
- **Symptom:** Capture worked on the initial turn/chat, but subsequent turns or newly opened chats resulted in `RESPONSE_PENDING` (`userCount: 1, assistantCount: 0`).
- **Root Cause:** In modern ChatGPT DOM, ancestor markdown/prose containers were collected and marked duplicate children in DOM order, discarding the assistant node and leaving only a single user container. Additionally, client-side SPA navigation left unmounted/inactive `<main>` elements in the DOM.
- **Fix:** 
  - Partitioned `findModernNodes` into discrete `asstContainers` and `userContainers`.
  - Retained outermost AI message blocks while selecting leaf user bubbles strictly outside any AI container.
  - Enhanced `chatScope()` to select the newest rendered `<main>` element and added an automatic document-wide fallback in `getLatestInteraction()` if scoped capture yields no complete pair.

### 2. Disclaimers or Feedback Surveys Captured as AI Response
- **Symptom:** Short prompts (e.g., `"hi"`) skipped length thresholds, causing the fallback strategy to pick the assistant answer as the user prompt and the footer disclaimer (*"ChatGPT can make mistakes..."*) as the response. In other threads, OpenAI's inline survey widget (*"Is this conversation helpful so far?"*) was captured instead of the real assistant message.
- **Root Cause:** Lack of semantic exclusion for system survey widgets and disclaimer footers; fallback splitting markdown blocks into orphaned `<p>` tags.
- **Fix:**
  - Added `isFeedbackOrDisclaimer(el)` matching survey text, feedback button groups, and system disclaimers.
  - Added a `< 200` character safeguard so genuine user messages or long assistant answers mentioning similar words are never falsely rejected.
  - Preserved `.markdown` container integrity in fallback strategies so full multi-paragraph responses and roadmaps are extracted intact.

### 3. Dropped Messages in Fixed SPA Layouts
- **Symptom:** Certain conversations were rejected by `isFixed()` checks when ChatGPT wrapped the main viewport in `fixed inset-0`.
- **Root Cause:** `isFixed()` traversed ancestors up toward `<body>`, flagging any ancestor with `position: fixed` even if it was the primary layout container.
- **Fix:** Scoped `isFixed()` to inspect the node itself and target actual portal roots (`[role="tooltip"]`, `[role="dialog"]`, `[data-radix-portal]`, `[data-floating-ui-portal]`) rather than climbing the entire viewport hierarchy.

### 4. Side Panel Tab Targeting
- **Symptom:** Triggering capture from the side panel occasionally targeted the side panel context or an unfocused window.
- **Root Cause:** `chrome.tabs.query({ active: true, currentWindow: true })` does not always resolve the underlying browser tab when the side panel has focus.
- **Fix:** Updated `getActiveTab()` in `extension/src/sidepanel/app.js` to prioritize `{ active: true, lastFocusedWindow: true }` before falling back to `currentWindow`.

---

## Files Changed

- [`extension/src/content/chatgpt.js`](file:///d:/devPost/WDAIDT/extension/src/content/chatgpt.js):
  - Partitioned assistant/user container discovery in `findModernNodes`.
  - Added `isFeedbackOrDisclaimer` guard with character-limit safeguards.
  - Hardened `isFixed` overlay portal detection.
  - Added active rendered `<main>` resolution and document-wide fallback in `getLatestInteraction`.
- [`extension/src/sidepanel/app.js`](file:///d:/devPost/WDAIDT/extension/src/sidepanel/app.js):
  - Updated `getActiveTab` to query `lastFocusedWindow`.
  - Ensured reliable card clearing and diagnostic error state handling.
- [`tests/extension/capture.test.js`](file:///d:/devPost/WDAIDT/tests/extension/capture.test.js):
  - Upgraded test harness `makeEl` helper to support deep text concatenation.
  - Added 7 comprehensive regression test cases covering multi-turn exchanges, SPA client navigation, fixed viewport wrappers, short prompt handling, and feedback survey exclusion.
- [`README.md`](file:///d:/devPost/WDAIDT/README.md):
  - Added Day 4 milestone checklist, updated test metrics (46 extension + 20 backend tests), and documented multi-turn SPA reliability.
- [`docs/DAY4.md`](file:///d:/devPost/WDAIDT/docs/DAY4.md):
  - This document.

---

## Test Verification Report

### Extension Test Suite (`node --test`)
```powershell
node --test tests/extension/*.test.js
```
**Results:** **46/46 passed** (0 failures, 0 skipped)
- `tests/extension/day1.smoke.test.js`: 5/5 pass
- `tests/extension/capture.test.js`: 31/31 pass (includes multi-turn, SPA transitions, feedback exclusion, fixed layouts)
- `tests/extension/auto.test.js`: 6/6 pass
- `tests/extension/pipeline.test.js`: 4/4 pass

### Backend Test Suite (`pytest`)
```powershell
python -m pytest tests/backend/ -q
```
**Results:** **20/20 passed** (0 failures)
- Health check and API schemas verified.
- Error envelopes and 422/413 validations verified.
- Gemini mock analysis, retry logic, and hedged wording verified.

---

## Status
- **Day 4 Deliverables Complete**: Multi-turn reliability, SPA navigation resilience, survey/disclaimer exclusion, passing full test suites, verified live in browser.
