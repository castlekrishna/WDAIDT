"""API Router for /analyze and /health endpoints."""

from fastapi import APIRouter
from app.analysis.analyzer import analyzer
from app.models.analysis import (
    AnalysisRequest,
    AnalysisResult,
    HealthResponse,
    MAX_PROMPT_CHARS,
    MAX_RESPONSE_CHARS,
)
from app.models.exceptions import AnalysisException

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint used by extension to verify backend connectivity."""
    return HealthResponse(status="ok")


@router.post("/analyze", response_model=AnalysisResult)
async def analyze_interaction(request: AnalysisRequest):
    """Analyze the interaction pair (prompt + response) and return structured debug insights."""
    # Size limits validation per API agreement (Section 2 & 4)
    if len(request.prompt) > MAX_PROMPT_CHARS or len(request.response) > MAX_RESPONSE_CHARS:
        raise AnalysisException(
            code="PAYLOAD_TOO_LARGE",
            message="Prompt or response exceeds maximum allowed length.",
            status_code=413,
        )

    # Empty or whitespace-only validation
    if not request.prompt.strip() or not request.response.strip():
        raise AnalysisException(
            code="INVALID_REQUEST",
            message="Prompt and response must both be non-empty strings.",
            status_code=422,
        )

    result = await analyzer.analyze(
        prompt=request.prompt,
        response=request.response,
        request_id=request.request_id,
    )
    return result
