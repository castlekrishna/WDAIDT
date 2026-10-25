---
doc: spec
status: approved
---

# Why Did AI Do That? (WDAIDT) — Technical Spec

## How This Works, In Plain Language
WDAIDT consists of two coordinated pieces: a Chrome browser extension that lives in the side panel alongside ChatGPT, and a lightweight local FastAPI backend running on your machine. When you click **Why?** (or when Auto Analyze detects a finished response), the extension reads the visible prompt, assistant reply, and preceding conversation turns directly from the web page. It sends this data to the local backend, which packages it inside an authoritative diagnostic prompt. The backend runs the analysis using Google Gemini (or a hermetic local mock engine) and returns a structured document describing what assumptions were made, what trade-offs were skipped, and what prompt to try next. The side panel renders this explanation safely using standard web elements.

## The Core Journey Through the System
1. **User Action**: The user submits a prompt in ChatGPT and triggers analysis (or stream mutation settles).
2. **Extraction (`chatgpt.js`)**: Content script traverses the DOM using 6 prioritized strategies, piercing open shadow roots, filtering out feedback surveys and footer disclaimers, and assembling the current pair plus up to 5 preceding dialogue turns.
3. **Transmission (`app.js`)**: The side panel packages the exchange into a JSON payload with client `request_id`, user-selected tone (`Friendly and conversational`), and depth (`Brief`), posting to `http://localhost:8000/analyze`.
4. **Validation & Budgeting (`analyze.py`)**: FastAPI validates inputs with Pydantic: prompt ≤ 8k chars, response ≤ 20k chars, context ≤ 40k chars / 20 exchanges.
5. **Prompt Composition (`prompts.py`)**: Assembles `ANALYSIS_SYSTEM_PROMPT` with runtime tone and depth guidelines, isolating conversation text within `<CURRENT_INTERACTION>` and `<CONVERSATION_HISTORY>` XML delimiters.
6. **Execution (`analyzer.py`)**: Invokes `gemini-3.5-flash-lite` (or hermetic mock engine) with 15-second timeout and automatic 1-retry on malformed JSON.
7. **Rendering (`app.js`)**: Validated `AnalysisDocument` is rendered into the DOM using pure `textContent` block constructors. The user clicks **Copy** on the suggested next prompt and pastes it back into ChatGPT.

## Stack
- **Extension Platform**: Chrome Manifest V3 (Chrome 114+ for Side Panel API).
- **Extension Runtime**: Vanilla JavaScript (ES2022), semantic HTML5, CSS3 Custom Properties.
- **Backend Service**: Python 3.10+, FastAPI (`>=0.110.0`), Starlette, Uvicorn (`>=0.28.0`).
- **Data Validation**: Pydantic v2 (`>=2.0.0`) discriminated union models.
- **AI Integration**: Google GenAI SDK (`google-genai>=1.0.0`), targeting model `gemini-3.5-flash-lite` with fallback to `gemini-flash-latest`.
- **Testing**: Node.js built-in test runner (`node:test`), Pytest (`>=8.0.0`), FastAPI TestClient (`httpx>=0.27.0`).

## Where It Runs and How Someone Tries It
- **Extension**: Loaded unpacked into Google Chrome from `extension/` via `chrome://extensions` with Developer Mode enabled.
- **Backend**: Runs locally via `python -m uvicorn app.main:app --app-dir backend --reload --port 8000`.
- **Evaluation Modes**:
  - *Mock Mode (Default)*: `MOCK_ANALYSIS=true` in `backend/.env`. Runs instantly offline with zero credentials.
  - *Live Gemini Mode*: `MOCK_ANALYSIS=false` with valid `GEMINI_API_KEY`.
- **Public Submission**: Requires public GitHub repository (`https://github.com/castlekrishna/WDAIDT`) and a short 1–3 minute demo video demonstrating the working proof of concept.

## Look and Feel
- **Theme**: Pitch-black Obsidian editor aesthetic (`#000000` background, `#111111` card elevation, `#303030` subtle borders, `#F2F2F2` primary text).
- **Typography**: Clean system sans-serif for UI labels; monospace for code blocks and previews.
- **Restraint**: Zero purple/gradient AI tropes; restrained monochrome controls with semantic status accents (green connected, amber analyzing, red error).
- **Accessibility**: High-contrast focus rings (`var(--focus-ring)`, `#E5E5E5`), keyboard operable (`Enter`/`Space` activation, `Escape` settings dismiss).

## Components

### Content Script (`extension/src/content/chatgpt.js`)
- Detects ChatGPT web pages (`chatgpt.com` and `chat.openai.com`).
- 6 extraction strategies: `role-attributes`, `message-id`, `conversation-turns`, `articles`, `modern-turns`, `content-blocks`.
- Stream watcher: MutationObserver tracking assistant text settlement with 2-second debounce.
- Non-conversation filter: Rejects UI chrome, aria-hidden subtrees, drag-and-drop announcers, and feedback surveys.

### Side Panel Controller (`extension/src/sidepanel/app.js`)
- Manages connectivity status polling against `GET /health`.
- Manages accordion expansion state and full-text independent scroll containers.
- Safely builds DOM elements for all 9 content block types without `innerHTML`.
- Retains `lastCapture` in memory for instant **Retry** recovery on server reconnect.
- Discards stale results by matching echoed `request_id`s.

### FastAPI Service (`backend/app/main.py` & `backend/app/api/analyze.py`)
- Endpoints: `GET /health` (`{"status": "ok"}`) and `POST /analyze`.
- Unified error envelopes (`{"error": {"code": "...", "message": "..."}}`) for 404, 405, 413, 422, 429, 502, 504.
- CORS configured with `allow_origins=["*"]` and `allow_credentials=False` to support `chrome-extension://` origins.

### Master Prompt & Analysis Engine (`backend/app/analysis/`)
- Single authoritative master system prompt enforcing epistemic modesty and prohibiting response narration.
- Runtime composition weaving master instructions with user-selected tone and depth presets.
- Passive XML delimiters defending against indirect prompt injection.

## Data Model

### Request Payload (`POST /analyze`)
```json
{
  "prompt": "string (1-8000 chars)",
  "response": "string (1-20000 chars)",
  "context": [
    {
      "prompt": "string (1-8000 chars)",
      "response": "string (1-20000 chars)"
    }
  ],
  "request_id": "optional-uuid-string",
  "response_style": "Friendly and conversational",
  "custom_instructions": null,
  "analysis_depth": "Brief"
}
```

### Analysis Document Output
```json
{
  "request_id": "uuid-string",
  "analysis": {
    "title": "Concise Diagnostic Title",
    "blocks": [
      {
        "type": "heading | paragraph | list | code | quote | table | callout | divider | next_prompt",
        "...": "type-specific validated fields"
      }
    ]
  }
}
```

## File Structure
```text
WDAIDT/
├── LICENSE                         # MIT License (2026 Krishna Kumar, Lidiya)
├── README.md                       # Permanent project overview & user guide
├── scope.md                        # Root planning scope document
├── prd.md                          # Root product requirements document
├── spec.md                         # Root technical specification
├── devpost/                        # Devpost Learn hackathon workspace
│   ├── scope.md                    # Canonical Devpost scope artifact
│   ├── prd.md                      # Canonical Devpost PRD artifact
│   ├── spec.md                     # Canonical Devpost technical spec artifact
│   └── checklist.md                # Build slices, verification checklist & map
├── docs/                           # Technical notes & changelog
│   ├── CHANGELOG.md                # Centralized changelog (V0.1–V0.9.2)
│   ├── SUBMISSION_READINESS.md     # Hackathon audit & readiness report
│   ├── V0.1.md through V0.8.md     # Historical milestone documentation
│   ├── V0.9.md                     # V0.9 release readiness documentation
│   └── V0.9.2.md                   # V0.9.2 compliance & audit release notes
├── extension/                      # Chrome Extension (Manifest V3)
│   ├── manifest.json               # MV3 configuration (v0.9.2)
│   ├── assets/                     # Extension icons (16px, 48px, 128px)
│   └── src/
│       ├── background/service-worker.js
│       ├── content/chatgpt.js
│       ├── shared/config.js & messages.js
│       └── sidepanel/app.js, index.html, styles.css
├── backend/                        # FastAPI Backend Service
│   ├── requirements.txt
│   ├── .env.example
│   └── app/
│       ├── main.py
│       ├── api/analyze.py
│       ├── analysis/analyzer.py & prompts.py
│       └── models/analysis.py & exceptions.py
└── tests/                          # Automated Regression Baselines
    ├── extension/                  # 103 Node.js unit & integration tests
    └── backend/                    # 60 Pytest unit & quality evaluation tests
```

## External Services and Dependencies
- **Google Gemini API**: Accessed via `google-genai` SDK over HTTPS (`https://generativelanguage.googleapis.com`). Requires `GEMINI_API_KEY` when `MOCK_ANALYSIS=false`.
- **ChatGPT**: Web application DOM (`chatgpt.com` and `chat.openai.com`) accessed client-side via content script permissions.

## Important Failure Modes
- **Backend Unreachable** &rarr; Red status indicator and error card appear. User starts the server and clicks **Retry**; retained `lastCapture` re-submits instantly.
- **ChatGPT Streaming Incomplete** &rarr; Content script surfaces honest `RESPONSE_PENDING` / `paired: false`; no premature request is submitted.
- **Malformed AI Output** &rarr; Backend analyzer triggers 1 automatic retry asking for valid JSON adhering to schema; if still unparseable, returns standard HTTP 502 `AI_PROVIDER_ERROR`.

## What Was Simplified and Why
- **Local Server over Cloud Deployment**: Eliminates hosting costs, prevents user session tracking, and keeps API keys strictly on the user's device.
- **Zero Ingestion Persistence**: No SQLite or PostgreSQL databases; interactions are processed in volatile memory and discarded.
- **Single Authoritative Master Prompt**: Avoids fragmented, drifting prompt templates by composing tone, depth, and context dynamically at request time.

## Decisions and Open Issues
- **Learner Decisions**: Prioritized clean Obsidian aesthetics, privacy-first ephemeral execution, and rapid "Brief" explanations by default.
- **Settled Technical Choices**: Chrome Manifest V3 Side Panel API, pure DOM `textContent` rendering, and strict size budgeting (30k char extension context limit).
- **Open Issues**: None blocking submission; live demo video must be recorded manually prior to Devpost deadline.
