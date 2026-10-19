# Why Did AI Do That? (WDAIDT)

Browser extension for ChatGPT that explains *what appears to have shaped* an AI response — factors, assumptions, and what could change the answer. Sidebar-first, manual or automatic.

> Scope note: **V0.1** through **V0.4** are complete ✅. **V0.5** lands UI modernization, adaptive light/dark theme, interactive toggle switch, and collapsible preview drawer.

---

## Progress by Milestone

### V0.1 — Lidiya ✅
- [x] Chrome Extension (Manifest V3) setup
- [x] ChatGPT page detection + latest prompt/response capture (`extension/src/content/chatgpt.js`)
- [x] Sidebar UI (`extension/src/sidepanel/`) with captured-text preview
- [x] Manual **Why?** button → capture → `POST /analyze`
- [x] Backend-unreachable behavior: explicit staged errors + Retry (no placeholder analysis)
- [x] Partial captures show `(not captured)` for the missing side instead of substituting fields
- [x] Auto toggle UI present (persisted, default OFF)
- [x] Smoke test: `node --test tests/extension/day1.smoke.test.js` (5 passing)
- [x] Milestone documentation (`docs/V0.1.md`)

### V0.2 — Krishna ✅
- [x] FastAPI backend setup (`backend/app/main.py`) with CORS & unified error envelopes
- [x] `GET /health` (`{"status":"ok"}`) and `POST /analyze` endpoints
- [x] Pydantic request/response/error schemas (`backend/app/models/analysis.py`)
- [x] Gemini API analysis engine (`gemini-3.5-flash-lite`) with multi-model fallback & 15s timeout
- [x] Realistic mock analysis mode (`MOCK_ANALYSIS=true`)
- [x] Curated test dataset with 6 interaction archetypes (`tests/backend/sample_data.py`)
- [x] Full unit test suite (`pytest tests/backend/ -v`, 20 passing: contract, limits, errors, explicit-mock, missing-key, retry paths)
- [x] Milestone documentation (`docs/V0.2.md`)

### V0.3 — Lidiya ✅
- [x] ChatGPT DOM selector patch for modern markup (`chatgpt.js` — 5 strategies: role attributes, message-id + affordances, conversation-turns, articles, structural content-blocks; shadow-DOM piercing; page fingerprint diagnostics)
- [x] Auto Analyze trigger on response stream completion + debounce (MutationObserver watcher in content script, 2s settle debounce, 500ms sidebar debounce, toggle persisted + pushed to open ChatGPT tabs)
- [x] Request ID stale-result guard (`wdaidtIsStaleResult` in `shared/messages.js`, enforced in sidebar before render)
- [x] Extension icons in `extension/assets/` (16/48/128, wired in `manifest.json` + action icon)
- [x] Capture reliability fix — hidden accessibility announcements (`aria-live`/`aria-hidden`/applicable roles), tooltips, menu chrome, fixed-position overlay portals, and `[hidden]/[inert]` content are excluded from extraction; `textContent` fallback gated on rendered elements; the structural fallback only accepts complete ordered pairs; no string-matching of specific messages (`docs/V0.3.md`)
- [x] End-to-end honesty hardening — paragraph breaks preserved capture→display; mock backend strictly opt-in (`MOCK_ANALYSIS=true`), missing key → actionable 502; staged errors with Retry instead of placeholder results; lengths-only structured logging (`docs/V0.3.md`)

### V0.4 — Capture Reliability & SPA Hardening ✅
- [x] Modern ChatGPT SPA multi-turn capture hardening (`extension/src/content/chatgpt.js`) — partitioned assistant/user container discovery avoids ancestor prose swallowing child user turns; prevents `RESPONSE_PENDING` on subsequent turns
- [x] Client-side SPA navigation resilience — dynamic active `<main>` scope selection with automatic full-document fallback across route changes and new chats
- [x] In-chat feedback survey & disclaimer exclusion — filtered survey prompt blocks ("Is this conversation helpful so far?") and system footers ("ChatGPT can make mistakes...") with a 200-char safeguard to preserve complete assistant roadmaps and short user prompts (e.g. "hi")
- [x] Fixed-position SPA container support — refined `isFixed()` checks to target overlay portals without pruning primary viewport wrappers (`fixed inset-0`)
- [x] Side panel window targeting — `getActiveTab()` queries `lastFocusedWindow` before `currentWindow` to reliably resolve active ChatGPT tabs when side panel has focus
- [x] Full regression test suites passing — 46 extension unit tests (`node --test tests/extension/*.test.js`) + 20 backend unit tests (`pytest tests/backend/`)
- [x] Milestone documentation (`docs/V0.4.md`)

### V0.5 — UI Modernization, Dual Theme & Polish ✅
- [x] Adaptive dual-theme system (`styles.css`) — auto light/dark mode aligned with ChatGPT's UI and OS color scheme
- [x] Modern iOS/Tailwind-style Auto toggle switch with smooth pill sliding animation
- [x] Dynamic status indicator with multi-state pulsing dot (Connected, Analyzing, Checking, Error)
- [x] Hero Analysis Presentation — highlighted "Why this answer?" summary box + color-accented cards for Influences, Assumptions, and What could change it
- [x] One-click Markdown copy button for complete formatted analysis export
- [x] Collapsible captured interaction drawer with speech-bubble badges and clean monospace previews
- [x] Skeleton shimmer loading animation during analysis requests
- [x] Version-based documentation convention (`docs/V0.1.md` through `docs/V0.5.md`)

---

## Repo Layout

```text
extension/
  manifest.json
  src/
    content/chatgpt.js            # Lidiya · V0.1 & V0.4 ✅ — robust capture engine
    sidepanel/                    # Lidiya · V0.1 & V0.5 ✅ — modernized UI + light/dark themes
    shared/messages.js            # Lidiya · V0.1 ✅ — message types
    shared/config.js              # Lidiya · V0.1 ✅ — backend URL + limits
    background/service-worker.js  # Lidiya · V0.1 ✅ — side-panel wiring
  assets/                         # icons (V0.3 polish)
backend/                          # Krishna · V0.2 ✅ (FastAPI + Gemini)
  app/
    main.py                       # FastAPI entry point, CORS, error handlers
    api/analyze.py                # /analyze and /health routes
    analysis/analyzer.py          # Gemini engine & fallback
    analysis/prompts.py           # Hedged wording prompts
    models/analysis.py            # Pydantic schemas
  requirements.txt
  .env.example
tests/
  extension/                      # Lidiya · 46 tests (5 smoke + 31 capture + 6 auto + 4 pipeline)
  backend/                        # Krishna · 20 unit tests
docs/
  V0.1.md                         # V0.1 extension handoff notes
  V0.2.md                         # V0.2 backend handoff notes
  V0.3.md                         # V0.3 extension + capture-reliability notes
  V0.4.md                         # V0.4 multi-turn SPA capture hardening notes
  V0.5.md                         # V0.5 UI modernization & dual-theme notes
```

---

## How to Run & Test

### 1. Start the Backend (Port 8000)
```powershell
# Install dependencies
pip install -r backend/requirements.txt

# Start local server
python -m uvicorn app.main:app --app-dir backend --reload --port 8000
```
- Interactive Swagger docs: [http://localhost:8000/docs](http://localhost:8000/docs)
- Health check: `curl http://localhost:8000/health`

### 2. Run Backend Tests
```powershell
python -m pytest tests/backend/ -v
```

### 3. Load the Extension (Chrome) and Run Its Tests
1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** → select `extension/`.
2. Open a ChatGPT conversation (`https://chatgpt.com`).
3. Click the extension icon in Chrome to open the Side Panel.
4. Click **Why?** to analyze the interaction. Toggle **Auto** ON to analyze new replies automatically once streaming finishes.
5. If capture fails, press **Copy diagnostics** in the error card and share the output — it fingerprints the page's actual markup.

```powershell
node --test tests/extension/capture.test.js tests/extension/auto.test.js tests/extension/day1.smoke.test.js tests/extension/pipeline.test.js
```
(46 passing: capture reliability incl. accessibility-noise exclusion, auto trigger + stale guard, manifest/config/UI contracts, capture-to-request pipeline, multi-turn SPA navigation, and feedback survey filtering.)

---

## API Contract (Locked)
- `POST /analyze` `{prompt, response, request_id?}` → `{request_id, why, influences[], assumptions[], what_could_change[]}`
- `GET /health` → `{"status":"ok"}`
- Limits: prompt ≤ 8,000 chars, response ≤ 20,000 chars (413 if exceeded).
- Standardized error shape: `{ "error": { "code": "...", "message": "..." } }`.
- Plain-text, hedged wording only ("appears to", "seems to").

---

## Privacy & Security
- Prompts and responses sent to the backend are processed in-memory for Gemini analysis and are **never stored** in any database.
- Full prompt text is never logged to disk or console.
- The `GEMINI_API_KEY` remains strictly in the backend local environment (`.env`) and is never sent to or accessible by the browser extension.

---

## Ownership
| Area | Owner |
|---|---|
| `extension/` | Lidiya |
| `backend/` | Krishna |
| Architecture / testing / docs / demo | Shared |
