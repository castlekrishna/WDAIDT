# DAY 1 — Lidiya · Extension V0.1

## Delivered
Extension setup (MV3) · ChatGPT detection · latest prompt/response capture ·
sidebar + manual Why? · backend call layer per API agreement · local-preview
fallback when backend is down · smoke test.

## Files
- `extension/manifest.json` — MV3, sidePanel, content_scripts for chatgpt.com
- `extension/src/content/chatgpt.js` — capture only, no backend, no analysis
- `extension/src/sidepanel/{index.html,app.js,styles.css}` — Why?, preview, POST /analyze, loading/error/Retry states
- `extension/src/shared/{messages.js,config.js}` — message types + backend URL/limits (single source of truth)
- `extension/src/background/service-worker.js` — open-panel-on-click
- `tests/extension/day1.smoke.test.js` — `node --test`

## Contract adherence (API agreement)
- Only side panel calls backend; content script never does. ✅
- `POST /analyze` with `{prompt, response, request_id}`, trims to 8k/20k. ✅
- Renders `{why, influences[], assumptions[], what_could_change[]}` as plain text via `textContent`. ✅
- Error codes surfaced: INVALID_REQUEST / PAYLOAD_TOO_LARGE(413) / RATE_LIMITED(429) / TIMEOUT / NETWORK("Can't reach…"). ✅
- Auto toggle persisted, default OFF, inert until Day 3. ✅

## Manual test checklist (5 min)
1. `chrome://extensions` → Load unpacked → `extension/` (expect no manifest errors).
2. `https://chatgpt.com` → DevTools → `await window.__WDAIDT__.getLatest()` returns `{prompt, response, onChatGPT:true}`.
3. Open side panel → Why? → capture preview appears.
4. Backend down → "Local preview — backend not connected" badge + sensible sections.
5. Backend mock up (`POST /analyze` example JSON) → real result, no badge.
6. Non-ChatGPT tab → friendly "Open a ChatGPT conversation…" error.
7. `node --test tests/extension/` → all pass.

## Day 2 handoff (Krishna)
Needs: `GET /health` + mock `POST /analyze` on `http://localhost:8000` returning the agreed example JSON. No extension changes needed — `WDAIDT_CONFIG.BACKEND_BASE_URL` is the only knob.

## Day 3 (Lidiya)
Wire Auto toggle → finished-response detection + debounce + `request_id` stale-guard; icons in `extension/assets/`; error-handling polish.
