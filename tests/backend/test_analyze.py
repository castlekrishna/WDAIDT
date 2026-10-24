"""Tests for POST /analyze endpoint and V0.6 Adaptive Document Contract."""

import json
import logging
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


def test_analyze_success_structure(monkeypatch):
    """Verify standard POST /analyze returns 200 OK with V0.6 document schema."""
    monkeypatch.setenv("MOCK_ANALYSIS", "true")
    payload = {
        "prompt": "Should I learn Python or Java for AI?",
        "response": "Python is generally recommended because of its AI ecosystem.",
        "request_id": "test-req-123",
    }
    res = client.post("/analyze", json=payload)
    assert res.status_code == 200

    data = res.json()
    assert data["request_id"] == "test-req-123"
    assert "analysis" in data
    assert isinstance(data["analysis"]["title"], str) and len(data["analysis"]["title"]) > 0
    assert isinstance(data["analysis"]["blocks"], list)
    assert len(data["analysis"]["blocks"]) >= 1


def test_analyze_single_paragraph_document(monkeypatch):
    """Verify an analysis document containing only one paragraph parses and returns 200."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Concise factual verification",
        "blocks": [
            {
                "type": "paragraph",
                "content": "The response directly answers the factual question with no unnecessary elaboration."
            }
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post("/analyze", json={"prompt": "Capital of France?", "response": "Paris.", "request_id": "single-p"})
    assert res.status_code == 200
    data = res.json()
    assert data["request_id"] == "single-p"
    assert data["analysis"]["title"] == "Concise factual verification"
    assert len(data["analysis"]["blocks"]) == 1
    assert data["analysis"]["blocks"][0]["type"] == "paragraph"
    assert "directly answers" in data["analysis"]["blocks"][0]["content"]


def test_analyze_multi_block_document_with_all_types(monkeypatch):
    """Verify a rich document containing every supported block type parses cleanly."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Comprehensive Technical Analysis",
        "blocks": [
            {"type": "heading", "level": 2, "content": "Overview"},
            {"type": "paragraph", "content": "The assistant provides a Python optimization technique."},
            {"type": "list", "style": "unordered", "items": ["Uses list comprehension", "Improves readability"]},
            {"type": "code", "language": "python", "content": "return [x * 2 for x in items]"},
            {"type": "quote", "content": "Premature optimization is the root of all evil."},
            {"type": "table", "headers": ["Approach", "Speed"], "rows": [["Loop", "1.2ms"], ["Comp", "0.8ms"]]},
            {"type": "callout", "variant": "tip", "title": "Performance Note", "content": "List comprehensions run in C."},
            {"type": "next_prompt", "title": "Recommended Next Step", "prompt": "Benchmark this against map() with timeit."},
            {"type": "divider"}
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post("/analyze", json={"prompt": "P", "response": "R", "request_id": "multi-block"})
    assert res.status_code == 200
    blocks = res.json()["analysis"]["blocks"]
    assert len(blocks) == 9
    types = [b["type"] for b in blocks]
    assert types == ["heading", "paragraph", "list", "code", "quote", "table", "callout", "next_prompt", "divider"]


def test_analyze_empty_collections_where_valid(monkeypatch):
    """Verify empty rows in table or empty items list are accepted when semantically valid."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Minimal collections",
        "blocks": [
            {"type": "paragraph", "content": "Valid text."},
            {"type": "list", "style": "ordered", "items": []},
            {"type": "table", "headers": ["Metric"], "rows": []}
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 200
    blocks = res.json()["analysis"]["blocks"]
    assert blocks[1]["items"] == []
    assert blocks[2]["rows"] == []


def test_analyze_invalid_block_type_returns_502(monkeypatch):
    """Verify unrecognized block types fail validation and trigger 502 AI_PROVIDER_ERROR."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Invalid Block Document",
        "blocks": [
            {"type": "unsupported_widget", "content": "This should fail"}
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


def test_analyze_invalid_field_types_returns_502(monkeypatch):
    """Verify wrong field types (e.g. content as integer) fail validation with 502."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Bad Field Types",
        "blocks": [
            {"type": "paragraph", "content": 12345}  # content must be string
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


def test_analyze_missing_required_title_returns_502(monkeypatch):
    """Verify document missing required title fails validation with 502."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "blocks": [
            {"type": "paragraph", "content": "Missing title"}
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


def test_analyze_empty_blocks_list_returns_502(monkeypatch):
    """Verify document with 0 blocks fails validation (min_length=1 required)."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Empty Document",
        "blocks": []
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


def test_analyze_oversized_blocks_returns_502(monkeypatch):
    """Verify document exceeding MAX_BLOCKS (50) fails validation with 502."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Oversized Document",
        "blocks": [{"type": "paragraph", "content": f"Block {i}"} for i in range(55)]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


@pytest.mark.parametrize("interaction", SAMPLE_INTERACTIONS, ids=[item["name"] for item in SAMPLE_INTERACTIONS])
def test_analyze_sample_interactions(interaction, monkeypatch):
    """Verify all sample dataset interaction types return valid structured responses."""
    monkeypatch.setenv("MOCK_ANALYSIS", "true")
    payload = {
        "prompt": interaction["prompt"],
        "response": interaction["response"],
        "request_id": interaction["request_id"],
    }
    res = client.post("/analyze", json=payload)
    assert res.status_code == 200

    data = res.json()
    assert data["request_id"] == interaction["request_id"]
    assert "analysis" in data
    assert isinstance(data["analysis"]["title"], str) and len(data["analysis"]["title"]) > 0
    assert isinstance(data["analysis"]["blocks"], list)
    assert len(data["analysis"]["blocks"]) >= 1

    # Check hedged tone verification in mock mode
    first_block_content = data["analysis"]["blocks"][0].get("content", "").lower()
    assert any(term in first_block_content for term in ["appears", "seems", "likely", "interpreted"])

    # Plain text check: no HTML tags
    assert "<html" not in first_block_content and "<script" not in first_block_content and "</div>" not in first_block_content


def test_response_style_and_depth_parameters(monkeypatch):
    """Verify response_style, custom_instructions, and analysis_depth parameters are accepted."""
    monkeypatch.setenv("MOCK_ANALYSIS", "true")
    payload = {
        "prompt": "How do closures work?",
        "response": "A closure retains access to variables from its parent scope.",
        "request_id": "req-style-01",
        "response_style": "Friendly and conversational",
        "custom_instructions": "Explain with a kitchen metaphor",
        "analysis_depth": "Brief",
    }
    res = client.post("/analyze", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["request_id"] == "req-style-01"
    assert "analysis" in data
    # Brief depth should produce minimal document (1 block)
    assert len(data["analysis"]["blocks"]) == 1


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


def test_unknown_fields_are_ignored_for_v2_forward_compatibility(monkeypatch):
    """Verify unknown fields like 'history' or 'session_id' are ignored without breaking."""
    monkeypatch.setenv("MOCK_ANALYSIS", "true")
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
    assert "analysis" in data


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


def test_explicit_mock_mode_returns_analysis_not_echo(caplog, monkeypatch):
    """Verify opt-in MOCK_ANALYSIS=true analyzes (never echoes inputs) and logs lengths, not content."""
    monkeypatch.setenv("MOCK_ANALYSIS", "true")
    prompt = (
        "Should PYTHON or JAVA Be Used For MACHINE LEARNING Pipelines Given "
        "Two Years Of Backend Experience And A Focus On Model Deployment?"
    )
    response = (
        "Python is generally recommended because of its extensive machine learning "
        "ecosystem and active research community."
    )
    with caplog.at_level(logging.INFO, logger="wdaidt.analyze"):
        res = client.post(
            "/analyze",
            json={"prompt": prompt, "response": response, "request_id": "mock-1"},
        )
    assert res.status_code == 200
    data = res.json()
    assert data["request_id"] == "mock-1"
    assert "analysis" in data
    doc = data["analysis"]
    assert doc["title"] != prompt and doc["title"] != response
    for block in doc["blocks"]:
        if "content" in block:
            assert block["content"] != prompt and block["content"] != response

    # Structured logs carry lengths only — never conversation content.
    logged = "\n".join(r.getMessage() for r in caplog.records if r.name == "wdaidt.analyze")
    assert "prompt_len=" in logged and "response_len=" in logged
    assert prompt not in logged
    assert response not in logged


def test_missing_api_key_returns_actionable_502(monkeypatch):
    """Verify a missing key (without explicit mock) fails honestly instead of mocking silently."""
    monkeypatch.setenv("GEMINI_API_KEY", "")
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 502
    data = res.json()
    assert data["error"]["code"] == "AI_PROVIDER_ERROR"
    assert "GEMINI_API_KEY" in data["error"]["message"]


def test_retry_succeeds_when_second_attempt_parses(monkeypatch):
    """Verify one retry: garbage output first, valid document second still yields 200."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    calls = []

    async def flaky(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            return "### not json at all ###"
        return json.dumps({
            "title": "Recovered Document",
            "blocks": [
                {"type": "paragraph", "content": "The response appears to answer the question."}
            ]
        })

    monkeypatch.setattr(analyzer, "_call_gemini_once", flaky)
    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 200
    assert len(calls) == 2
    assert res.json()["analysis"]["title"] == "Recovered Document"


def test_unparseable_output_after_retry_returns_502(monkeypatch):
    """Verify persistent garbage output exhausts the single retry and fails honestly."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    async def always_garbage(*args, **kwargs):
        return "### not json at all ###"

    monkeypatch.setattr(analyzer, "_call_gemini_once", always_garbage)
    res = client.post("/analyze", json={"prompt": "P", "response": "R"})
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "AI_PROVIDER_ERROR"


# =============================================================================
# WDAIDT Analysis Quality & Diagnostic Evaluation Tests (Section 7)
# =============================================================================

def test_system_prompt_enforces_anti_narration_and_diagnostic_goals():
    """Verify master system prompt explicitly forbids narration and establishes diagnostic goals."""
    from app.analysis.prompts import ANALYSIS_SYSTEM_PROMPT

    # Fundamental principle
    assert "WDAIDT must NOT explain to users what an AI response already tells them" in ANALYSIS_SYSTEM_PROMPT
    assert "Do not waste their attention repeating or summarizing" in ANALYSIS_SYSTEM_PROMPT

    # Explicit prohibitions against generic descriptive narration
    assert "The AI used a friendly tone" in ANALYSIS_SYSTEM_PROMPT
    assert "The AI provided a detailed explanation" in ANALYSIS_SYSTEM_PROMPT
    assert "The response contains several recommendations" in ANALYSIS_SYSTEM_PROMPT
    assert "The AI structured its answer into sections" in ANALYSIS_SYSTEM_PROMPT

    # Diagnostic guidance & epistemic boundaries
    assert "NEVER claim direct access to ChatGPT's hidden chain of thought" in ANALYSIS_SYSTEM_PROMPT
    assert "PRIORITIZE THE NEXT STEP" in ANALYSIS_SYSTEM_PROMPT
    assert "next_prompt" in ANALYSIS_SYSTEM_PROMPT


def test_quality_eval_ambiguous_learning_request(monkeypatch):
    """Case 1: Short ambiguous request followed by overly broad answer.
    Analysis must identify missing constraints and supply a concrete next prompt."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Diagnosis: Underspecified Learning Scope",
        "blocks": [
            {
                "type": "paragraph",
                "content": (
                    "The prompt asks 'How do I learn AI?' without specifying prior technical background, "
                    "time commitment, or mathematical depth. This appears to have led the AI to generate "
                    "an uncurated, broad curriculum rather than a focused learning path."
                )
            },
            {
                "type": "heading",
                "level": 2,
                "content": "Key Missing Constraints"
            },
            {
                "type": "list",
                "style": "unordered",
                "items": [
                    "Target domain unstated (e.g., applied LLMs vs. research math vs. computer vision).",
                    "Prior programming experience (Python/C++) omitted."
                ]
            },
            {
                "type": "next_prompt",
                "title": "Suggested Next Prompt",
                "prompt": (
                    "I am a backend Python developer with 2 years of experience. Give me a 3-month roadmap "
                    "focusing exclusively on building and deploying LLM applications with LangChain and FastAPI."
                )
            }
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post(
        "/analyze",
        json={
            "prompt": "How do I learn AI?",
            "response": "Here is everything about math, machine learning, deep learning, NLP, and vision...",
            "request_id": "eval-case-1"
        }
    )
    assert res.status_code == 200
    data = res.json()
    doc = data["analysis"]

    # Must NOT summarize or repeat the response
    full_text = " ".join(b.get("content", "") + " " + b.get("prompt", "") for b in doc["blocks"])
    assert "Here is everything about math" not in full_text
    assert "The AI provided a detailed explanation" not in full_text

    # Must diagnose missing information and provide concrete next prompt
    assert any("without specifying" in b.get("content", "") for b in doc["blocks"])
    next_prompts = [b for b in doc["blocks"] if b["type"] == "next_prompt"]
    assert len(next_prompts) == 1
    assert "roadmap" in next_prompts[0]["prompt"]


def test_quality_eval_coding_technical_issue(monkeypatch):
    """Case 2: Coding question where a concrete technical issue is omitted.
    Analysis must diagnose the concrete missing aspect (race condition/transaction), not narrate lines."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Omission: Missing Database Transaction & Concurrency Guard",
        "blocks": [
            {
                "type": "paragraph",
                "content": (
                    "The provided code executes a simple balance increment but omits database transaction isolation "
                    "and atomic constraint checks. Under concurrent execution, this can produce lost updates or negative balances."
                )
            },
            {
                "type": "callout",
                "variant": "warning",
                "title": "Concurrency Vulnerability",
                "content": "No 'SELECT ... FOR UPDATE' or optimistic locking versioning is implemented."
            },
            {
                "type": "next_prompt",
                "title": "Suggested Next Prompt",
                "prompt": "How can I wrap this balance update in an atomic transaction with optimistic locking in SQLAlchemy?"
            }
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post(
        "/analyze",
        json={
            "prompt": "How do I update balance?",
            "response": "def update_balance(user_id, amt): user.balance += amt; db.save(user)",
            "request_id": "eval-case-2"
        }
    )
    assert res.status_code == 200
    doc = res.json()["analysis"]
    # Actionable diagnosis present
    assert any("transaction" in b.get("content", "").lower() for b in doc["blocks"])
    # Next prompt addresses the specific technical limitation
    next_p = [b for b in doc["blocks"] if b["type"] == "next_prompt"][0]
    assert "optimistic locking" in next_p["prompt"]


def test_quality_eval_satisfactory_factual_response(monkeypatch):
    """Case 3: Factual response that is already satisfactory.
    Analysis must acknowledge fulfillment without manufacturing artificial flaws."""
    monkeypatch.setenv("MOCK_ANALYSIS", "true")
    res = client.post(
        "/analyze",
        json={
            "prompt": "What is the capital of France?",
            "response": "The capital of France is Paris.",
            "request_id": "eval-case-3"
        }
    )
    assert res.status_code == 200
    doc = res.json()["analysis"]
    first_block = doc["blocks"][0]["content"].lower()

    # Must acknowledge fulfillment and avoid inventing problems
    assert any(term in first_block for term in ["satisfies", "accurate", "unambiguous", "directly"])
    assert "unsupported claim" not in first_block
    assert "critical flaw" not in first_block


def test_quality_eval_recommendation_lacking_constraint(monkeypatch):
    """Case 4: Recommendation that lacks an important user constraint.
    Analysis must identify unstated criteria and provide targeted next prompt."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Missing Architecture Constraints",
        "blocks": [
            {
                "type": "paragraph",
                "content": (
                    "The recommendation compares PostgreSQL and MongoDB on broad feature lists because the prompt "
                    "omitted the data relationship structure, consistency requirements (ACID), and expected query volume."
                )
            },
            {
                "type": "next_prompt",
                "title": "Suggested Next Prompt",
                "prompt": (
                    "I am building a financial ledger with highly relational foreign keys and strict ACID requirements. "
                    "Given this constraint, evaluate PostgreSQL vs MongoDB for write-heavy transactional workloads."
                )
            }
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post(
        "/analyze",
        json={
            "prompt": "Postgres or Mongo for my backend?",
            "response": "Both are great choices. Postgres is relational and Mongo is document...",
            "request_id": "eval-case-4"
        }
    )
    assert res.status_code == 200
    doc = res.json()["analysis"]
    assert any("omitted" in b.get("content", "").lower() for b in doc["blocks"])
    next_p = [b for b in doc["blocks"] if b["type"] == "next_prompt"][0]
    assert "financial ledger" in next_p["prompt"] or "constraint" in next_p["prompt"]


def test_quality_eval_unsupported_claim(monkeypatch):
    """Case 5: Response containing a potentially unsupported claim.
    Analysis communicates epistemic uncertainty without asserting hidden model states."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Evaluation: Unsupported Timeline Assertion",
        "blocks": [
            {
                "type": "paragraph",
                "content": (
                    "The response asserts that quantum computers will break standard RSA encryption within the next year. "
                    "This claim appears unsupported by published NIST post-quantum standardization roadmaps."
                )
            },
            {
                "type": "callout",
                "variant": "caution",
                "title": "Verification Needed",
                "content": "The visible evidence does not substantiate this timeline. Plausible scientific estimates place cryptanalytically relevant quantum computers much further out."
            },
            {
                "type": "next_prompt",
                "title": "Verification Prompt",
                "prompt": "What does the latest NIST post-quantum cryptography transition guidance state regarding RSA timeline risks?"
            }
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post(
        "/analyze",
        json={
            "prompt": "When will quantum break RSA?",
            "response": "Quantum computers will definitely break all RSA-2048 encryption by next year.",
            "request_id": "eval-case-5"
        }
    )
    assert res.status_code == 200
    doc = res.json()["analysis"]
    full_text = " ".join(b.get("content", "") for b in doc["blocks"])
    # Communicates epistemic uncertainty rather than dogmatic certainty
    assert "appears unsupported" in full_text
    assert "does not substantiate" in full_text


def test_quality_eval_creative_task_satisfies_goal(monkeypatch):
    """Case 6: Creative task that meets stated goal.
    Analysis verifies fulfillment and avoids arbitrary manufactured criticism."""
    from app.api.analyze import analyzer
    monkeypatch.setenv("MOCK_ANALYSIS", "false")
    monkeypatch.setenv("GEMINI_API_KEY", "dummy-key")

    mock_doc = {
        "title": "Constraint Verification: Couplet Completed",
        "blocks": [
            {
                "type": "paragraph",
                "content": (
                    "The response directly satisfies all explicit constraints of the prompt: it is a 2-line rhyming couplet "
                    "focusing on the morning ocean. The meter and imagery align with the requested theme."
                )
            },
            {
                "type": "callout",
                "variant": "note",
                "title": "Next Refinement (Optional)",
                "content": "No correction is needed. If you want a specific meter such as iambic pentameter, add that constraint in a follow-up."
            }
        ]
    }

    async def mock_call(*args, **kwargs):
        return json.dumps(mock_doc)

    monkeypatch.setattr(analyzer, "_call_gemini_once", mock_call)

    res = client.post(
        "/analyze",
        json={
            "prompt": "Write a 2-line rhyming couplet about the morning ocean.",
            "response": "The morning ocean greets the rising sun,\nAs gentle waves upon the gold sand run.",
            "request_id": "eval-case-6"
        }
    )
    assert res.status_code == 200
    doc = res.json()["analysis"]
    assert any("satisfies all explicit constraints" in b.get("content", "") for b in doc["blocks"])

