"""API Router for /analyze and /health endpoints in WDAIDT V0.8."""

import logging
import time

from fastapi import APIRouter
from app.analysis.analyzer import analyzer
from app.models.analysis import (
    AnalysisRequest,
    AnalysisResult,
    HealthResponse,
    MAX_PROMPT_CHARS,
    MAX_RESPONSE_CHARS,
    MAX_CONTEXT_EXCHANGES,
    MAX_CONTEXT_TOTAL_CHARS,
)
from app.models.exceptions import AnalysisException

router = APIRouter()
logger = logging.getLogger("wdaidt.analyze")


@router.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint used by extension to verify backend connectivity."""
    return HealthResponse(status="ok")


@router.post("/analyze", response_model=AnalysisResult)
async def analyze_interaction(request: AnalysisRequest):
    """Analyze the interaction pair alongside optional conversation context."""
    started = time.perf_counter()
    prompt_len = len(request.prompt)
    response_len = len(request.response)
    context = request.context or []
    context_count = len(context)
    context_chars = sum(len(ex.prompt) + len(ex.response) for ex in context)

    # Size limits validation per API agreement
    if (
        prompt_len > MAX_PROMPT_CHARS
        or response_len > MAX_RESPONSE_CHARS
        or context_count > MAX_CONTEXT_EXCHANGES
        or context_chars > MAX_CONTEXT_TOTAL_CHARS
    ):
        logger.warning(
            "analyze rejected code=PAYLOAD_TOO_LARGE prompt_len=%d response_len=%d context_count=%d context_chars=%d",
            prompt_len,
            response_len,
            context_count,
            context_chars,
        )
        raise AnalysisException(
            code="PAYLOAD_TOO_LARGE",
            message="Prompt, response, or context exceeds maximum allowed length.",
            status_code=413,
        )

    # Empty or whitespace-only validation for current interaction
    if not request.prompt.strip() or not request.response.strip():
        logger.warning(
            "analyze rejected code=INVALID_REQUEST prompt_len=%d response_len=%d",
            prompt_len,
            response_len,
        )
        raise AnalysisException(
            code="INVALID_REQUEST",
            message="Prompt and response must both be non-empty strings.",
            status_code=422,
        )

    result = await analyzer.analyze(
        prompt=request.prompt,
        response=request.response,
        context=context,
        request_id=request.request_id,
        response_style=request.response_style,
        custom_instructions=request.custom_instructions,
        analysis_depth=request.analysis_depth,
    )

    block_count = len(result.analysis.blocks) if result.analysis and result.analysis.blocks else 0
    logger.info(
        "analyze ok request_id=%s prompt_len=%d response_len=%d context_count=%d context_chars=%d blocks=%d latency_ms=%d",
        request.request_id,
        prompt_len,
        response_len,
        context_count,
        context_chars,
        block_count,
        int((time.perf_counter() - started) * 1000),
    )
    return result
