# DAY 2 — Krishna · Backend V0.2

## Delivered
FastAPI backend service (`backend/`) · locked API agreement compliance · `/health` & `/analyze` · Pydantic models · Gemini API analysis engine (`gemini-3.5-flash-lite`) · automatic 1-retry & 15s timeout · realistic mock fallback · shared test dataset (`tests/backend/sample_data.py`) · 16 automated tests (`pytest`).

## Files Created
- `backend/requirements.txt` — FastAPI, Uvicorn, Pydantic, Google-GenAI, Pytest
- `backend/.env.example` — template for `GEMINI_API_KEY`, `GEMINI_MODEL`, `MOCK_ANALYSIS`
- `backend/app/main.py` — FastAPI application, CORS (`*`), unified error handlers
- `backend/app/api/analyze.py` — `GET /health` and `POST /analyze` routes + 8k/20k limit enforcement
- `backend/app/models/analysis.py` — `AnalysisRequest`, `AnalysisResult`, `ErrorResponse`, `HealthResponse`
- `backend/app/models/exceptions.py` — custom `AnalysisException`
- `backend/app/analysis/prompts.py` — system instructions enforcing hedged language & plain text
- `backend/app/analysis/analyzer.py` — core analysis pipeline, live Gemini integration + mock fallback
- `tests/backend/sample_data.py` — 6 interaction test fixtures (recommendation, ambiguous, factual, missing context, code-heavy, non-English)
- `tests/backend/test_health.py` — `/health` verification
- `tests/backend/test_analyze.py` — 15 comprehensive unit tests (schema, limits, error mapping, tone, dataset)

## Contract Adherence (API Agreement)
- `GET /health` returns `{"status": "ok"}` with 200. ✅
- `POST /analyze` takes `{prompt, response, request_id?}` and returns `{request_id, why, influences[], assumptions[], what_could_change[]}`. ✅
- Character limits: rejects prompt > 8,000 or response > 20,000 with HTTP 413 `PAYLOAD_TOO_LARGE`. ✅
- Empty or whitespace-only prompts/responses trigger HTTP 422 `INVALID_REQUEST`. ✅
- Overrode FastAPI default 422 to always match `{ "error": { "code": "...", "message": "..." } }`. ✅
- Error codes mapped: `INVALID_REQUEST`, `PAYLOAD_TOO_LARGE`, `RATE_LIMITED`, `AI_PROVIDER_ERROR`, `TIMEOUT`, `INTERNAL`. ✅
- Hedged tone enforced ("appears to", "seems to"). ✅
- Zero changes to Lidiya's code in `extension/` or `tests/extension/`. ✅

## How to Run Backend
```powershell
python -m uvicorn app.main:app --app-dir backend --reload --port 8000
```
Swagger UI docs live reference: `http://localhost:8000/docs`

## How to Run Tests
```powershell
python -m pytest tests/backend/ -v
```
All 16 tests passing.
