# Why Did AI Do That? (WDAIDT)

Browser extension for ChatGPT that explains *what appears to have shaped* an AI response — factors, assumptions, and what could change the answer. Sidebar-first, manual or automatic.

> Scope note: **Day 1 (Extension V0.1)** and **Day 2 (Backend V0.2)** are complete ✅. Day 3 lands Auto Analyze (V0.3).

---

## Progress by Milestone

### Day 1 (V0.1) — Lidiya ✅
- [x] Chrome Extension (Manifest V3) setup
- [x] ChatGPT page detection + latest prompt/response capture (`extension/src/content/chatgpt.js`)
- [x] Sidebar UI (`extension/src/sidepanel/`) with captured-text preview
- [x] Manual **Why?** button → capture → `POST /analyze`
- [x] Backend-unreachable fallback: clearly-labelled **local preview** mode
- [x] Auto toggle UI present (persisted, default OFF)
- [x] Smoke test: `node --test tests/extension/day1.smoke.test.js` (5 passing)

### Day 2 (V0.2) — Krishna ✅
- [x] FastAPI backend setup (`backend/app/main.py`) with CORS & unified error envelopes
- [x] `GET /health` (`{"status":"ok"}`) and `POST /analyze` endpoints
- [x] Pydantic request/response/error schemas (`backend/app/models/analysis.py`)
- [x] Gemini API analysis engine (`gemini-3.5-flash-lite`) with multi-model fallback & 15s timeout
- [x] Realistic mock analysis mode (`MOCK_ANALYSIS=true`)
- [x] Curated test dataset with 6 interaction archetypes (`tests/backend/sample_data.py`)
- [x] Full unit test suite (`pytest tests/backend/ -v`, 16 passing)
- [x] Day 2 handoff documentation (`docs/DAY2.md`)

### Day 3 (V0.3) — Upcoming ⏳
- [ ] ChatGPT DOM selector patch for modern markup (`chatgpt.js`)
- [ ] Auto Analyze trigger on response stream completion + debounce
- [ ] Request ID stale-result guard
- [ ] Extension icons in `extension/assets/`

---

## Repo Layout

```text
extension/
  manifest.json
  src/
    content/chatgpt.js            # Lidiya · Day 1 ✅ — capture only
    sidepanel/                    # Lidiya · Day 1 ✅ — Why? + preview + backend call
    shared/messages.js            # Lidiya · Day 1 ✅ — message types
    shared/config.js              # Lidiya · Day 1 ✅ — backend URL + limits
    background/service-worker.js  # Lidiya · Day 1 ✅ — side-panel wiring
  assets/                         # icons (Day 3 polish)
backend/                          # Krishna · Day 2 ✅ (FastAPI + Gemini)
  app/
    main.py                       # FastAPI entry point, CORS, error handlers
    api/analyze.py                # /analyze and /health routes
    analysis/analyzer.py          # Gemini engine & fallback
    analysis/prompts.py           # Hedged wording prompts
    models/analysis.py            # Pydantic schemas
  requirements.txt
  .env.example
tests/
  extension/                      # Lidiya · Day 1 ✅ (5 smoke tests)
  backend/                        # Krishna · Day 2 ✅ (16 unit tests)
docs/
  DAY1.md                         # Day-1 extension handoff notes
  DAY2.md                         # Day-2 backend handoff notes
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

### 3. Load the Extension (Chrome)
1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** → select `extension/`.
2. Open a ChatGPT conversation (`https://chatgpt.com`).
3. Click the extension icon in Chrome to open the Side Panel.
4. Click **Why?** to analyze the interaction.

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
