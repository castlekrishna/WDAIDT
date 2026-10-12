# Why Did AI Do That? (WDAIDT)

Browser extension for ChatGPT that explains *what appears to have shaped* an AI response — factors, assumptions, and what could change the answer. Sidebar-first, manual or automatic.

> Scope note: this repo is mid-build. **Day 1 = Lidiya's extension V0.1 only** (this commit). Krishna's backend (`backend/`) lands Day 2. Auto Analyze lands Day 3 (V0.3).

## Day 1 (V0.1) — this commit ✅
- [x] Chrome Extension (Manifest V3) setup
- [x] ChatGPT page detection + latest prompt/response capture (`extension/src/content/chatgpt.js`)
- [x] Sidebar UI (`extension/src/sidepanel/`) with captured-text preview
- [x] Manual **Why?** button → capture → `POST /analyze` (contract per `docs/DAY1.md`)
- [x] Backend-unreachable fallback: clearly-labelled **local preview** so Day 1 is demoable before the mock API is live
- [x] Auto toggle UI present (persisted, default OFF) but not active until Day 3
- [x] Smoke test: `node --test tests/extension/`

**Not in Day 1:** backend/Gemini (Day 2), Auto Analyze triggering + debounce (Day 3), history/accounts/dashboards (never in V1).

## Repo layout (target V1)
```
extension/
  manifest.json
  src/
    content/chatgpt.js      # Lidiya · Day 1 ✅ — capture only
    sidepanel/              # Lidiya · Day 1 ✅ — Why? + preview + backend call
    shared/messages.js      # Lidiya · Day 1 ✅ — message types
    shared/config.js        # Lidiya · Day 1 ✅ — backend URL + limits
    background/service-worker.js  # Lidiya · Day 1 ✅ — side-panel wiring
  assets/                   # icons (Day 3 polish)
backend/                    # Krishna · Day 2 (FastAPI + Gemini)
tests/extension/            # Lidiya · Day 1 ✅
docs/DAY1.md                # Day-1 scope + load-test checklist
```

## Try Day 1 (Chrome)
1. Open `chrome://extensions`, enable **Developer mode**, **Load unpacked** → select `extension/`.
2. Open a ChatGPT conversation (`https://chatgpt.com`), ask something.
3. Click the extension icon (opens side panel) → click **Why?**.
4. Without backend: you get capture preview + local-preview analysis. With Krishna's mock on `http://localhost:8000`, you get the real `POST /analyze` result.

## API contract (locked, full text in group chat)
- `POST /analyze` `{prompt, response, request_id?}` → `{request_id, why, influences[], assumptions[], what_could_change[]}`
- `GET /health` → `{"status":"ok"}`
- Limits: prompt ≤ 8,000 chars, response ≤ 20,000 (extension trims; backend 413s oversize).
- Extension → backend timeout 20s. Plain-text, hedged wording only.

## Ownership
| Area | Owner |
|---|---|
| `extension/` | Lidiya |
| `backend/` | Krishna |
| arch / testing / docs / demo | shared |
