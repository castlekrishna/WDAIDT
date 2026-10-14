"""Pydantic data models for Why Did AI Do That? (WDAIDT).

Single source of truth for the API agreement between Extension and Backend.
"""

from typing import List, Optional
from pydantic import BaseModel, ConfigDict, Field

MAX_PROMPT_CHARS = 8000
MAX_RESPONSE_CHARS = 20000


class AnalysisRequest(BaseModel):
    """Incoming request to POST /analyze."""
    model_config = ConfigDict(extra="ignore")

    prompt: str = Field(
        ...,
        description="The latest user message.",
    )
    response: str = Field(
        ...,
        description="The latest ChatGPT assistant reply.",
    )
    request_id: Optional[str] = Field(
        default=None,
        description="Optional client-generated ID echoed back to ignore stale results.",
    )


class AnalysisResult(BaseModel):
    """Structured response returned by POST /analyze."""
    model_config = ConfigDict(extra="ignore")

    request_id: Optional[str] = Field(
        default=None,
        description="Echoed client request_id if provided.",
    )
    why: str = Field(
        ...,
        description="Main interpretation or reasoning behind the response (1-2 sentences, ~300 chars max).",
    )
    influences: List[str] = Field(
        default_factory=list,
        description="Important factors that appear to have shaped the answer (2-4 short strings).",
    )
    assumptions: List[str] = Field(
        default_factory=list,
        description="Important assumptions the AI appears to have made (1-3 short strings).",
    )
    what_could_change: List[str] = Field(
        default_factory=list,
        description="Conditions or details that could lead to a different answer (1-3 short strings).",
    )


class ErrorDetail(BaseModel):
    """Inner error payload."""
    code: str = Field(..., description="Machine-readable error code.")
    message: str = Field(..., description="Human-readable safe error message.")


class ErrorResponse(BaseModel):
    """Standardized error envelope per API agreement."""
    error: ErrorDetail


class HealthResponse(BaseModel):
    """GET /health response."""
    status: str = "ok"
