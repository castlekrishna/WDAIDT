"""Tests for POST /analyze endpoint and data contract compliance."""

import sys
from pathlib import Path
import pytest

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from app.main import app
from app.models.analysis import MAX_PROMPT_CHARS, MAX_RESPONSE_CHARS
from tests.backend.sample_data import SAMPLE_INTERACTIONS

client = TestClient(app)


def test_analyze_success_structure():
    """Verify standard POST /analyze returns 200 OK with correct keys and types."""
    payload = {
        "prompt": "Should I learn Python or Java for AI?",
        "response": "Python is generally recommended because of its AI ecosystem.",
        "request_id": "test-req-123",
    }
    res = client.post("/analyze", json=payload)
    assert res.status_code == 200

    data = res.json()
    assert data["request_id"] == "test-req-123"
    assert isinstance(data["why"], str) and len(data["why"]) > 0
    assert isinstance(data["influences"], list)
    assert isinstance(data["assumptions"], list)
    assert isinstance(data["what_could_change"], list)


@pytest.mark.parametrize("interaction", SAMPLE_INTERACTIONS, ids=[item["name"] for item in SAMPLE_INTERACTIONS])
def test_analyze_sample_interactions(interaction):
    """Verify all sample dataset interaction types return valid structured responses."""
    payload = {
        "prompt": interaction["prompt"],
        "response": interaction["response"],
        "request_id": interaction["request_id"],
    }
    res = client.post("/analyze", json=payload)
    assert res.status_code == 200

    data = res.json()
    assert data["request_id"] == interaction["request_id"]
    assert "why" in data and isinstance(data["why"], str)
    assert "influences" in data and isinstance(data["influences"], list)
    assert "assumptions" in data and isinstance(data["assumptions"], list)
    assert "what_could_change" in data and isinstance(data["what_could_change"], list)

    # Hedged tone verification: should not claim absolute truth
    lower_why = data["why"].lower()
    assert any(term in lower_why for term in ["appears", "seems", "likely", "interpreted"])

    # Plain text check: no HTML tags
    assert "<html" not in data["why"] and "<script" not in data["why"] and "</div>" not in data["why"]


def test_validation_error_missing_fields_422():
    """Verify missing required fields triggers 422 with agreed error shape."""
    res = client.post("/analyze", json={"prompt": "Hello only"})
    assert res.status_code == 422
    data = res.json()
    assert "error" in data
    assert data["error"]["code"] == "INVALID_REQUEST"
    assert isinstance(data["error"]["message"], str)


def test_validation_error_empty_string_422():
    """Verify empty or whitespace-only prompt triggers 422 INVALID_REQUEST."""
    res = client.post("/analyze", json={"prompt": "   ", "response": "Valid response."})
    assert res.status_code == 422
    data = res.json()
    assert "error" in data
    assert data["error"]["code"] == "INVALID_REQUEST"


def test_validation_error_empty_response_422():
    """Verify empty or whitespace-only response triggers 422 INVALID_REQUEST."""
    res = client.post("/analyze", json={"prompt": "Valid prompt.", "response": "  \n\t  "})
    assert res.status_code == 422
    data = res.json()
    assert "error" in data
    assert data["error"]["code"] == "INVALID_REQUEST"


def test_payload_too_large_prompt_413():
    """Verify oversized prompt (>8000 chars) triggers 413 PAYLOAD_TOO_LARGE."""
    oversized_prompt = "A" * (MAX_PROMPT_CHARS + 1)
    res = client.post("/analyze", json={"prompt": oversized_prompt, "response": "Short response."})
    assert res.status_code == 413
    data = res.json()
    assert "error" in data
    assert data["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_payload_too_large_response_413():
    """Verify oversized response (>20000 chars) triggers 413 PAYLOAD_TOO_LARGE."""
    oversized_response = "B" * (MAX_RESPONSE_CHARS + 1)
    res = client.post("/analyze", json={"prompt": "Short prompt.", "response": oversized_response})
    assert res.status_code == 413
    data = res.json()
    assert "error" in data
    assert data["error"]["code"] == "PAYLOAD_TOO_LARGE"


def test_unknown_fields_are_ignored_for_v2_forward_compatibility():
    """Verify unknown fields like 'history' or 'session_id' are ignored without breaking."""
    payload = {
        "prompt": "Test prompt",
        "response": "Test response",
        "request_id": "req-compat-1",
        "history": [{"role": "user", "content": "prior msg"}],
        "metadata": {"source": "v2_client"},
    }
    res = client.post("/analyze", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["request_id"] == "req-compat-1"
    assert "why" in data


def test_timeout_exception_mapping_504(monkeypatch):
    """Verify timeout translates to HTTP 504 with TIMEOUT code."""
    from app.models.exceptions import AnalysisException

    async def mock_timeout(*args, **kwargs):
        raise AnalysisException("TIMEOUT", "Gemini took too long.", status_code=504)

    from app.api.analyze import analyzer
    monkeypatch.setattr(analyzer, "analyze", mock_timeout)

    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 504
    data = res.json()
    assert data == {"error": {"code": "TIMEOUT", "message": "Gemini took too long."}}


def test_ai_provider_error_mapping_502(monkeypatch):
    """Verify provider error translates to HTTP 502 with AI_PROVIDER_ERROR code."""
    from app.models.exceptions import AnalysisException

    async def mock_provider_err(*args, **kwargs):
        raise AnalysisException("AI_PROVIDER_ERROR", "Analysis failed. Please try again.", status_code=502)

    from app.api.analyze import analyzer
    monkeypatch.setattr(analyzer, "analyze", mock_provider_err)

    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 502
    data = res.json()
    assert data == {"error": {"code": "AI_PROVIDER_ERROR", "message": "Analysis failed. Please try again."}}

