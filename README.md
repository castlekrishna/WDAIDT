# Why Did AI Do That? (WDAIDT)

Browser extension for ChatGPT that explains *what appears to have shaped* an AI response. Sidebar-first, manual or automatic.

> Scope note: **V0.1** through **V0.6** are complete ✅. **V0.7** introduces **Multi-Context Analysis**, allowing Gemini to analyze the latest AI response alongside relevant preceding conversation exchanges from the same ChatGPT thread with configurable context windows and deterministic size budgets.

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
- [x] Hero Analysis Presentation — highlighted "Why this answer?" summary box + color-accented cards
- [x] One-click Markdown copy button for complete formatted analysis export
- [x] Collapsible captured interaction drawer with speech-bubble badges and clean monospace previews
- [x] Skeleton shimmer loading animation during analysis requests
- [x] Version-based documentation convention (`docs/V0.1.md` through `docs/V0.5.md`)

### V0.6 — Adaptive Analysis Architecture, Dynamic Document Renderer & Quality Overhaul ✅
- [x] **Flexible Document Architecture**: Replaced the rigid 4-category analysis schema with validated `AnalysisDocument` envelopes containing an ordered collection of validated content blocks.
- [x] **9 Content Block Types**: Full Pydantic and DOM support for `heading` (levels 1-6), `paragraph`, `list` (ordered/unordered), `code` (with copy button), `quote`, responsive `table`, `callout` (6 visual variants), `next_prompt` (ready-to-use follow-up prompt with copy button), and section `divider`.
- [x] **Analysis Quality & Diagnostic Focus**: Master prompt explicitly instructs the model NOT to summarize or narrate the original response, but to diagnose missing constraints, omitted trade-offs, and concrete next actions.
- [x] **Authoritative Master Prompt**: Base system prompt establishing WDAIDT's role, epistemic boundaries (hedged interpretations without claiming access to model weights), anti-narration prohibitions, and passive-data protection against prompt injection.
- [x] **Runtime Prompt Composition**: Composes master prompt with user-selected Response Style, custom instructions, and Analysis Depth at request time.
- [x] **Persistent Settings UI**: Side panel settings drawer with 7 Response Style presets (Friendly, Witty, Casual, Professional, Formal, Academic, Custom) and 3 Analysis Depth settings (Brief, Balanced, Detailed) saved to `chrome.storage.local`.
- [x] **Safe Dynamic Renderer**: Pure DOM `textContent` rendering without arbitrary HTML injection, safe code snippet copying, and rich Markdown export.
- [x] **Sidebar Space Optimization**: `#captureCard` is collapsed by default upon opening the side panel, prioritizing analysis document visibility above the fold.
- [x] **Full-Text Independently Scrollable Container**: Removed the 600-character preview truncation (`PREVIEW_CHARS`) from the expanded view. Captured prompt and response are displayed in full inside a bounded, independently scrollable container (`max-height: 240px; overflow-y: auto; overscroll-behavior-y: contain`).
- [x] **Data Integrity & Payload Alignment**: Audited prompt/response transmission end-to-end. Diagnosed the root cause of ellipsis truncation ("Lists, tuple...") as UI-only string truncation in `app.js`. Aligned displayed text with request payload via `trimForBackend` (matching backend limits `MAX_PROMPT_CHARS = 8000` and `MAX_RESPONSE_CHARS = 20000`).
- [x] **Expansion State Preservation**: Starting, finishing, or failing an analysis preserves the user's current accordion toggle state.
- [x] **Accessibility & Keyboard Navigation**: Full keyboard toggling (`Enter` / `Space`), `aria-expanded`, `aria-controls`, `role="button"`, and high-contrast `:focus-visible` styling.
- [x] **Comprehensive Test Verification**: 36 backend tests (`pytest tests/backend/`) and 68 extension tests (`node --test tests/extension/*.test.js`) passing cleanly (104 tests total).
- [x] **Milestone Documentation**: Comprehensive reference in `docs/V0.6.md`.
### V0.7 — Multi-Context Analysis ✅
- [x] **Configurable Context Window**: Side panel settings control for maximum preceding exchanges (0, 3, 5, 10 previous exchanges; default: 5) persisted in `chrome.storage.local`.
- [x] **Maximum Context Limit (Never a Minimum)**: Analysis executes seamlessly regardless of whether 0, 1, 2, 5, or 12 prior turns exist. Never blocks, errors, or invents synthetic placeholder messages when history is smaller than the configured window.
- [x] **Separation of Concerns**: Current prompt and response are always captured, validated, and evaluated separately from historical context; never duplicated in history.
- [x] **Chronological Pairing & Regeneration Support**: Historical turns are ordered oldest-to-newest. Multi-draft regenerated assistant turns reliably pair the latest response with its prompt.
- [x] **Deterministic Context Budgeting**: Enforces strict payload limits (30,000 char extension budget / 40,000 char backend acceptance; 20 max context exchanges). Prioritizes most recent complete turns and drops older turns whole; never truncates current interaction.
- [x] **API Contract Extension**: `POST /analyze` supports optional `context: List[ContextExchange]` with 100% backward compatibility for single-exchange callers.
- [x] **Master Prompt Context Guidance**: Instructs Gemini to use history as evidence for missed constraints or contradictions while strictly prohibiting conversation summaries and response narration.
- [x] **UI Transparency Badge**: Captured Interaction card displays exact included exchange count (`"Current exchange only"`, `"Context: 1 previous exchange"`, `"Context: N previous exchanges"`).
- [x] **Full Regression & Safety**: 51 backend tests (`pytest tests/backend/`) and 91 extension tests (`node --test tests/extension/*.test.js`) passing cleanly (142 tests total).
- [x] **Milestone Documentation**: Comprehensive reference in `docs/V0.7.md`.


---

## Repo Layout

```text
extension/
  manifest.json
  src/
    content/chatgpt.js            # Capture engine & DOM mutation watcher
    sidepanel/                    # Side panel UI, Obsidian styles, & dynamic document renderer
      app.js                      # Controller, block renderers, & settings persistence
      index.html                  # Side panel layout, settings panel, & document container
      styles.css                  # Obsidian pitch-black theme & block typography
    shared/messages.js            # Message types & stale-result guards
    shared/config.js              # Backend URLs, limits, & style/depth presets
    background/service-worker.js  # Side panel runtime wiring
  assets/                         # Icons (16/48/128)
backend/
  app/
    main.py                       # FastAPI entry point, CORS, error handlers
    api/analyze.py                # /analyze and /health routes
    analysis/analyzer.py          # Gemini engine, structured JSON validation & fallback
    analysis/prompts.py           # Master prompt & runtime style/depth composition
    models/analysis.py            # Pydantic schemas for document and content blocks
  requirements.txt
  .env.example
tests/
  extension/                      # 91 tests (smoke, capture, auto, pipeline, dynamic renderer, capture audit, context window)
  backend/                        # 51 unit tests (schema, block types, quality evaluation, limits, errors, retries, multi-context)
docs/
  V0.1.md                         # V0.1 extension handoff notes
  V0.2.md                         # V0.2 backend handoff notes
  V0.3.md                         # V0.3 extension + capture-reliability notes
  V0.4.md                         # V0.4 multi-turn SPA capture hardening notes
  V0.5.md                         # V0.5 UI modernization & dual-theme notes
  V0.6.md                         # V0.6 Adaptive analysis architecture & quality overhaul notes
  V0.7.md                         # V0.7 Multi-context analysis & configurable window notes
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
4. Click the gear icon to customize **Response Style** and **Analysis Depth**.
5. Click **Why?** to analyze the interaction. Toggle **Auto** ON to analyze new replies automatically once streaming finishes.
6. If capture fails, press **Copy diagnostics** in the error card to inspect page markup fingerprinting.

```powershell
node --test tests/extension/*.test.js
```

---

## API Contract (V0.6)
- `POST /analyze` `{prompt, response, request_id?, response_style?, custom_instructions?, analysis_depth?}` → `{request_id, analysis: {title, blocks: [...]}}`
- `GET /health` → `{"status":"ok"}`
- Limits: prompt ≤ 8,000 chars, response ≤ 20,000 chars (413 if exceeded).
- Standardized error shape: `{ "error": { "code": "...", "message": "..." } }`.
- Supported block types: `heading`, `paragraph`, `list`, `code`, `quote`, `table`, `callout`, `divider`.
- Safe text, hedged wording ("appears to", "seems to").

---

## Privacy & Security
- Prompts and responses sent to the backend are processed in-memory for Gemini analysis and are **never stored** in any database.
- Full prompt text is never logged to disk or console (lengths only).
- The `GEMINI_API_KEY` remains strictly in the backend local environment (`.env`) and is never sent to or accessible by the browser extension.

---

## Ownership
| Area | Owner |
|---|---|
| `extension/` | Lidiya |
| `backend/` | Krishna |
| Architecture / testing / docs / demo | Shared |
