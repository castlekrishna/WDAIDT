# Why Did AI Do That? (WDAIDT)

Browser extension for ChatGPT that explains *what appears to have shaped* an AI response. Sidebar-first, manual or automatic.

> Current version: **V0.9.0** — **Submission Polish & Release Readiness**. Prepared for hackathon evaluation and V1.0 release, featuring 163 passing automated tests (103 extension + 60 backend), live Gemini API verification, zero-config mock mode, and refined Obsidian pitch-black UX.

---

## What is WDAIDT?

When developers, researchers, and power users interact with ChatGPT, models often take unexpected architectural paths, omit critical edge cases, misunderstand underlying goals, or overlook earlier constraints. Traditional debugging requires manual prompt dissection and trial-and-error follow-ups.

**Why Did AI Do That? (WDAIDT)** brings real-time response diagnostics directly into the ChatGPT sidebar. It non-intrusively captures completed exchanges, analyzes them using Google Gemini, and delivers structured, editor-like explanations that diagnose *why* the response took that form and suggest concrete, ready-to-use next prompts.

### Core Features

- **Side-Panel Native (Chrome MV3)**: Operates seamlessly alongside ChatGPT in the browser side panel without cluttering the chat view.
- **On-Demand & Automatic Analysis**: Click **Why?** to analyze the latest exchange, or toggle **Auto** to analyze new replies automatically once streaming settles.
- **Configurable Multi-Context Reasoning**: Seamlessly incorporates preceding turns (0, 3, 5, or 10 previous exchanges) to detect overlooked constraints, contradicted clarifications, and ambiguous references across multi-turn sessions.
- **9 Structured Document Block Types**: Renders explanations as clean dynamic documents supporting headings (H1–H6), paragraphs, ordered/unordered lists, code snippets (with copy button), blockquotes, tables, visual callouts (info, warning, caution, tip, note, important), section dividers, and suggested next prompts.
- **Obsidian Pitch-Black Theme**: True pitch-black (`#000000`) developer aesthetic with high-contrast typography, restrained monochrome controls, and subtle status colors.
- **Epistemic Modesty & Anti-Narration**: Evaluates visible evidence and missing constraints rather than re-narrating the chat; uses hedged phrasing without claiming private access to model weights.
- **Zero-Config Mock Mode & Live Gemini**: Out-of-the-box offline evaluation with realistic mock analysis (`MOCK_ANALYSIS=true`) or live analysis using `gemini-3.5-flash-lite`.
- **Privacy First**: In-memory ephemeral processing only. No databases, no telemetry, lengths-only structured logs, and API keys remain strictly on the backend.

---

## Technology Stack

- **Extension**: Chrome Manifest V3, Side Panel API, Vanilla JavaScript (ES2022), Pure DOM rendering (Zero `innerHTML`), CSS custom properties.
- **Backend**: Python 3.10+, FastAPI, Uvicorn, Pydantic v2, Google GenAI SDK (`google-genai`).
- **AI Models**: Google Gemini (`gemini-3.5-flash-lite` with automatic fallback to `gemini-flash-latest`).
- **Testing**: Node.js built-in test runner (`node:test`), Pytest, FastAPI TestClient (`httpx`).

---

## Quick Start & Evaluation Guide

Follow these steps to run and evaluate WDAIDT from a clean checkout.

### Prerequisites

- **Python**: Version 3.10 or higher (`python --version`).
- **Node.js**: Version 18.0 or higher (`node --version`).
- **Google Chrome**: Version 114 or higher (Side Panel API support).

---

### Step 1: Configure & Start the Backend

1. **Install backend dependencies**:
   ```powershell
   pip install -r backend/requirements.txt
   ```

2. **Configure environment variables**:
   Create `backend/.env` from `backend/.env.example`:
   ```powershell
   # Windows PowerShell
   Copy-Item backend/.env.example backend/.env

   # Linux / macOS / Bash
   cp backend/.env.example backend/.env
   ```

3. **Choose your evaluation mode** in `backend/.env`:
   - **Option A: Mock Mode (Zero-Config, Recommended for Offline Evaluation)**:
     Leave `MOCK_ANALYSIS=true` (the default in `.env.example`). No API key is required. The backend returns realistic, structured diagnostic documents instantly.
   - **Option B: Live Gemini Mode**:
     Set `MOCK_ANALYSIS=false` and provide your Google Gemini API key:
     ```env
     GEMINI_API_KEY=your_actual_gemini_api_key_here
     GEMINI_MODEL=gemini-3.5-flash-lite
     MOCK_ANALYSIS=false
     HOST=0.0.0.0
     PORT=8000
     ```

4. **Start the local server**:
   From the repository root:
   ```powershell
   python -m uvicorn app.main:app --app-dir backend --reload --port 8000
   ```
   *(Or navigate into `backend/` and run `uvicorn app.main:app --reload --port 8000`)*.

5. **Verify the server is running**:
   - Health check: Open [http://localhost:8000/health](http://localhost:8000/health) or run `curl http://localhost:8000/health` (returns `{"status":"ok"}`).
   - Interactive Swagger API docs: [http://localhost:8000/docs](http://localhost:8000/docs).

---

### Step 2: Load the Extension in Google Chrome

1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the top-right corner.
3. Click the **Load unpacked** button in the top-left corner.
4. Select the `extension/` directory inside this repository.
5. Confirm that **Why Did AI Do That? (WDAIDT)** appears in your extensions list (Version 0.9.0).

---

### Step 3: Run Your First Analysis

1. Open ChatGPT at [https://chatgpt.com](https://chatgpt.com) (or `https://chat.openai.com`).
2. Click the puzzle-piece icon in Chrome's toolbar and **pin** the WDAIDT extension icon.
3. Click the WDAIDT icon to open the **Side Panel**.
4. Check the top status indicator: it will show a green dot and `Backend: reachable at http://localhost:8000`.
5. Have a conversation with ChatGPT (e.g., ask: *"What are the trade-offs of microservices vs monoliths?"*).
6. Once the assistant finishes responding:
   - Click the **Why?** button.
   - The side panel will display the captured interaction in a collapsed accordion, send the interaction to Gemini, and render the structured diagnostic document.
   - Click the **Copy** button to export the entire document as clean Markdown, or copy specific code blocks and suggested follow-up prompts.
7. **Toggle Auto Analyze**: Switch **Auto** to ON in the top bar. Submit a new prompt; WDAIDT will automatically analyze each new response as soon as streaming finishes.
8. **Customize Settings**: Click the gear icon to customize **Response Style** (7 presets or custom instructions), **Analysis Depth** (Brief, Balanced, Detailed), and **Context Window** (0, 3, 5, 10 previous exchanges). Press `Escape` or click **Done** to close the settings panel.
9. **Error Recovery**: If the backend is stopped or unavailable, WDAIDT displays a clear diagnostic card with a **Retry** button. Restart the backend and click **Retry** to immediately re-analyze the captured interaction without re-selecting tabs.

---

## Running the Automated Test Suites

WDAIDT maintains a comprehensive automated regression baseline of **163 tests** across the extension and backend.

### 1. Extension Test Suite (103 Tests)
Verifies manifest validity, DOM capture strategies, shadow DOM piercing, SPA navigation resilience, auto-analysis debouncing, multi-context size budgeting, dynamic document block rendering, and backend error recovery:
```powershell
node --test tests/extension/*.test.js
```
*(All 103 tests pass with 0 failures in ~5 seconds)*.

### 2. Backend Test Suite (60 Tests)
Verifies Pydantic schema validation, all 9 document block types, payload limits (413), validation errors (422), error envelopes (404, 405, 502, 504), mock mode, master prompt anti-narration, multi-context omission detection, contradiction detection, and passive data injection isolation:
```powershell
python -m pytest tests/backend/ -v
```
*(All 60 tests pass with 0 failures in ~1 second)*.

---

## Repo Layout

```text
extension/
  manifest.json                   # Chrome Manifest V3 configuration (v0.9.0)
  assets/                         # Extension icons (16, 48, 128)
  src/
    content/chatgpt.js            # 6-tier DOM capture engine & stream mutation watcher
    sidepanel/                    # Side panel UI & Obsidian pitch-black view
      app.js                      # Controller, dynamic document renderers, retry recovery, settings
      index.html                  # Side panel layout, settings drawer, document container
      styles.css                  # Obsidian pitch-black theme, typography, & focus rings
    shared/
      messages.js                 # Runtime message types & stale-result guards
      config.js                   # Backend URL, payload limits, & style/depth presets
    background/
      service-worker.js           # Chrome runtime wiring & side panel behavior
backend/
  app/
    main.py                       # FastAPI entry point, CORS, unified error envelopes
    api/analyze.py                # /analyze and /health routes
    analysis/
      analyzer.py                 # Gemini analysis engine, timeout, retry, & mock mode
      prompts.py                  # Master system prompt & runtime prompt composition
    models/
      analysis.py                 # Pydantic models for AnalysisDocument & 9 block types
      exceptions.py               # Unified domain exceptions and status codes
  requirements.txt                # Python dependencies
  .env.example                    # Template for Gemini API key & mock configuration
tests/
  extension/                      # 103 unit & integration tests (Node.js test runner)
  backend/                        # 60 unit tests & quality evaluations (pytest)
docs/
  V0.1.md through V0.8.md         # Historical milestone documentation
  V0.9.md                         # V0.9 release readiness and audit documentation
```

---

## API Overview (V0.9)

### `GET /health`
Returns service availability status.
- **Response** `200 OK`: `{"status": "ok"}`

### `POST /analyze`
Analyzes a ChatGPT interaction and returns a validated dynamic analysis document.

**Request Envelope**:
```json
{
  "prompt": "Write a quicksort in C.",
  "response": "void quicksort(int arr[], int low, int high) { ... }",
  "context": [
    {
      "prompt": "I am working with an embedded microcontroller with 16KB RAM.",
      "response": "Understood, memory is strictly constrained."
    }
  ],
  "request_id": "optional-uuid",
  "response_style": "Professional and direct",
  "custom_instructions": null,
  "analysis_depth": "Balanced"
}
```

**Limits**:
- `prompt`: ≤ 8,000 characters (413 if exceeded).
- `response`: ≤ 20,000 characters (413 if exceeded).
- `context`: ≤ 20 exchanges and ≤ 40,000 total characters (413 if exceeded).

**Response Envelope**:
```json
{
  "request_id": "uuid",
  "analysis": {
    "title": "Applying Embedded RAM Constraints to the Quicksort Implementation",
    "blocks": [
      {
        "type": "paragraph",
        "content": "Evaluated the latest exchange alongside 1 preceding exchange..."
      },
      {
        "type": "callout",
        "variant": "warning",
        "title": "Stack Exhaustion Risk",
        "content": "Recursive quicksort call stacks can exhaust 16KB RAM on adversarial inputs."
      },
      {
        "type": "next_prompt",
        "title": "Suggested Next Prompt",
        "prompt": "Can you provide an iterative version with an explicit bounded stack?"
      }
    ]
  }
}
```

**Standardized Error Envelope**:
```json
{
  "error": {
    "code": "AI_PROVIDER_ERROR",
    "message": "GEMINI_API_KEY is not configured. Set it in backend/.env..."
  }
}
```

---

## Privacy & Security

- **Zero Interaction Persistence**: Prompts and responses sent to the backend are evaluated in volatile memory and are **never stored** in databases or log files.
- **Lengths-Only Logging**: Application logs record string lengths only (`promptLen`, `responseLen`, `contextCount`) — full interaction text is never written to disk or console.
- **Credential Protection**: The `GEMINI_API_KEY` remains strictly in `backend/.env`. It is never transmitted to or accessible by the browser extension.
- **Passive Data Isolation**: Untrusted conversation inputs are encapsulated within passive XML delimiters in prompts (`<CURRENT_INTERACTION>` and `<CONVERSATION_HISTORY>`) to defend against indirect prompt injection.
- **CORS Restricted**: Credentials disabled (`allow_credentials=False`); restricted to JSON payloads.

---

## Milestone Progress

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
- [x] **Flexible Document Architecture**: Replaced rigid 4-category analysis schema with validated `AnalysisDocument` envelopes containing an ordered collection of validated content blocks.
- [x] **9 Content Block Types**: Full Pydantic and DOM support for `heading` (levels 1-6), `paragraph`, `list` (ordered/unordered), `code` (with copy button), `quote`, responsive `table`, `callout` (6 visual variants), `next_prompt` (ready-to-use follow-up prompt with copy button), and section `divider`.
- [x] **Analysis Quality & Diagnostic Focus**: Master prompt explicitly instructs the model NOT to summarize or narrate the original response, but to diagnose missing constraints, omitted trade-offs, and concrete next actions.
- [x] **Authoritative Master Prompt**: Base system prompt establishing WDAIDT's role, epistemic boundaries (hedged interpretations without claiming access to model weights), anti-narration prohibitions, and passive-data protection against prompt injection.
- [x] **Runtime Prompt Composition**: Composes master prompt with user-selected Response Style, custom instructions, and Analysis Depth at request time.
- [x] **Persistent Settings UI**: Side panel settings drawer with 7 Response Style presets and 3 Analysis Depth settings saved to `chrome.storage.local`.
- [x] **Safe Dynamic Renderer**: Pure DOM `textContent` rendering without arbitrary HTML injection, safe code snippet copying, and rich Markdown export.
- [x] **Sidebar Space Optimization**: `#captureCard` collapsed by default upon opening the side panel, prioritizing analysis document visibility above the fold.
- [x] **Full-Text Independently Scrollable Container**: Removed 600-character preview truncation from expanded view; bounded container (`max-height: 240px; overflow-y: auto; overscroll-behavior-y: contain`).
- [x] **Data Integrity & Payload Alignment**: Aligned displayed text with request payload via `trimForBackend` (matching backend limits `MAX_PROMPT_CHARS = 8000` and `MAX_RESPONSE_CHARS = 20000`).
- [x] **Accessibility & Keyboard Navigation**: Full keyboard toggling (`Enter` / `Space`), `aria-expanded`, `aria-controls`, `role="button"`, and high-contrast `:focus-visible` styling.
- [x] **Comprehensive Test Verification**: 36 backend tests and 68 extension tests passing cleanly (104 tests total).
- [x] **Milestone Documentation**: Comprehensive reference in `docs/V0.6.md`.

### V0.7 — Multi-Context Analysis ✅
- [x] **Configurable Context Window**: Side panel settings control for maximum preceding exchanges (0, 3, 5, 10 previous exchanges; default: 5) persisted in `chrome.storage.local`.
- [x] **Maximum Context Limit (Never a Minimum)**: Analysis executes seamlessly regardless of whether 0, 1, 2, 5, or 12 prior turns exist without blocking or synthetic placeholders.
- [x] **Separation of Concerns**: Current prompt and response are always captured, validated, and evaluated separately from historical context; never duplicated in history.
- [x] **Chronological Pairing & Regeneration Support**: Historical turns are ordered oldest-to-newest. Multi-draft regenerated assistant turns reliably pair the latest response with its prompt.
- [x] **Deterministic Context Budgeting**: Enforces strict payload limits (30,000 char extension budget / 40,000 char backend acceptance; 20 max context exchanges). Prioritizes most recent complete turns and drops older turns whole.
- [x] **API Contract Extension**: `POST /analyze` supports optional `context: List[ContextExchange]` with 100% backward compatibility for single-exchange callers.
- [x] **Master Prompt Context Guidance**: Instructs Gemini to use history as evidence for missed constraints or contradictions while strictly prohibiting conversation summaries and response narration.
- [x] **UI Transparency Badge**: Captured Interaction card displays exact included exchange count (`"Current exchange only"`, `"Context: 1 previous exchange"`, `"Context: N previous exchanges"`).
- [x] **Full Regression & Safety**: 51 backend tests and 91 extension tests passing cleanly (142 tests total).
- [x] **Milestone Documentation**: Comprehensive reference in `docs/V0.7.md`.

### V0.8 — Stabilization & Reliability Release ✅
- [x] **Comprehensive Functional Audit**: Systematic audit across 7 verification areas (ChatGPT capture, multi-context analysis, extension-to-backend integration, backend reliability, analysis quality/safety, Obsidian UI/accessibility, and security/privacy).
- [x] **Extension Integration Hardening**: Verified payload transmission, custom instruction gating, HTTP error status mappings (413, 422, 429, 502, network failure, timeout), stale result dropping, and Auto Analyze messaging.
- [x] **Backend Reliability & Error Envelopes**: Verified `GET /health`, standardized 404/405 error envelopes, input validation, and backward compatibility for `context: null` requests.
- [x] **Multi-Context Quality & Safety Tests**: Validated diagnostic detection of overlooked user constraints, contradicted environment clarifications, ambiguous follow-ups, and isolation of prompt injection payloads as passive data.
- [x] **Live Gemini API Verification**: Confirmed end-to-end execution of both single-turn and multi-context queries with live Google Gemini API (`gemini-3.5-flash-lite`).
- [x] **Full Regression Test Coverage**: 102 extension unit tests and 60 backend unit tests passing cleanly (162 tests total).
- [x] **Milestone Documentation**: Comprehensive reference in `docs/V0.8.md`.

### V0.9 — Submission Polish & Release Readiness ✅
- [x] **Submission Polish & Usability Audit**: Full audit of installation, first-run experience, settings persistence, error recovery, and Obsidian UI styling.
- [x] **Resilient Retry Recovery**: Implemented smart `runRetry()` workflow retaining and directly re-submitting `lastCapture` across backend disconnects and timeouts without requiring ChatGPT tab re-selection.
- [x] **Accessibility & Keyboard Navigation**: Fixed undefined focus ring variable in CSS (`--focus-ring`), added `Escape` shortcut to dismiss settings drawer, and verified high-contrast keyboard indicators.
- [x] **API Contract Alignment**: Documented complete V0.9 contract with multi-context parameters (`context: List[ContextExchange]`) and 9 supported block types including `next_prompt`.
- [x] **Evaluator-Focused First-Run Experience**: Detailed walkthrough for backend environment (`.env.example`), mock mode vs live Gemini analysis, and Chrome unpacked loading.
- [x] **Full Regression Baseline**: 103 extension tests (`node --test tests/extension/*.test.js`) and 60 backend tests (`pytest tests/backend/`) passing cleanly (**163 tests total**, 100% pass rate).
- [x] **Milestone Documentation**: Comprehensive reference in `docs/V0.9.md`.

---

## Ownership
| Area | Owner |
|---|---|
| `extension/` | Lidiya |
| `backend/` | Krishna |
| Architecture / testing / docs / demo | Shared |
