"""Core analysis engine for WDAIDT V0.6.

Transforms (Prompt + AI Response) into an adaptive, structured document:
- AnalysisDocument with title and ordered collection of validated content blocks.
- Master prompt with runtime style and depth preference composition.
- Diagnostic analysis prioritizing omissions, improvements, and concrete next actions.
- Gemini API with automatic retry, 15s timeout, and mock fallback.
"""

import asyncio
import json
import logging
import os
import re
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

# Ensure backend/.env is loaded even if run from repository root
backend_env = Path(__file__).resolve().parent.parent.parent / ".env"
if backend_env.exists():
    load_dotenv(dotenv_path=backend_env)
else:
    load_dotenv()

from app.analysis.prompts import (
    ANALYSIS_SYSTEM_PROMPT,
    build_analysis_user_prompt,
    compose_system_instructions,
)
from app.models.analysis import (
    AnalysisDocument,
    AnalysisResult,
    CalloutBlock,
    CodeBlock,
    DividerBlock,
    HeadingBlock,
    ListBlock,
    NextPromptBlock,
    ParagraphBlock,
    QuoteBlock,
    TableBlock,
)
from app.models.exceptions import AnalysisException

logger = logging.getLogger("wdaidt.analyzer")


def _clean_json_text(raw_text: str) -> str:
    """Extract raw JSON substring from LLM response if wrapped in markdown code blocks."""
    cleaned = raw_text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    if match:
        cleaned = match.group(1).strip()
    return cleaned


def generate_mock_analysis(
    prompt: str,
    response: str,
    request_id: Optional[str] = None,
    response_style: Optional[str] = None,
    analysis_depth: Optional[str] = None,
) -> AnalysisResult:
    """Generate realistic diagnostic mock analysis conforming strictly to V0.6 quality standards."""
    clean_p = prompt.strip()
    lower_p = clean_p.lower()
    first_line = clean_p.split("\n")[0][:80] if clean_p else "Interaction"

    # Detect simple satisfactory queries (e.g., direct factual lookups)
    is_simple_factual = any(
        kw in lower_p for kw in ["capital of", "who wrote", "what is the speed of", "how many days"]
    ) and len(clean_p) < 60

    if is_simple_factual:
        # Don't manufacture problems when the response directly satisfies the request
        blocks = [
            ParagraphBlock(
                content="The response appears to directly and accurately satisfy the factual question without extraneous assumptions. "
                "No significant omissions or corrective actions are required."
            )
        ]
        if analysis_depth != "Brief":
            blocks.append(
                CalloutBlock(
                    variant="tip",
                    title="Assessment",
                    content="The query was unambiguous, and the AI appears to have provided the verified standard answer. "
                    "Refinements are unnecessary unless you wish to explore historical context or related data.",
                )
            )
        doc = AnalysisDocument(
            title=f"Satisfactory Factual Exchange: {first_line}",
            blocks=blocks,
        )
        return AnalysisResult(request_id=request_id, analysis=doc)

    # General diagnostic analysis: identify missing constraints and supply a concrete next prompt
    blocks = [
        ParagraphBlock(
            content=f"The AI appears to have adopted a broad, generalized interpretation because the prompt lacks specific constraints "
            f"(such as deployment environment, performance requirements, or prior background). "
            "While the answer covers standard industry conventions, it omits key trade-offs and edge cases relevant to targeted use."
        )
    ]

    if analysis_depth != "Brief":
        blocks.extend([
            HeadingBlock(level=2, content="Diagnostic Findings"),
            ListBlock(
                style="unordered",
                items=[
                    "Missing constraints: Specific scale, existing tech stack, or budget boundaries were unstated, prompting the AI to assume generic defaults.",
                    "Omitted trade-offs: The answer focuses on the most popular path without detailing maintenance overhead or migration friction.",
                ],
            ),
        ])

        if analysis_depth == "Detailed":
            blocks.append(
                CalloutBlock(
                    variant="info",
                    title="Underlying Assumption",
                    content="The response seems to assume greenfield development with modern standard tooling, "
                    "which may not apply if integrating into an existing legacy architecture.",
                )
            )

        # Supply a ready-to-use follow-up prompt
        blocks.append(
            NextPromptBlock(
                title="Suggested Next Prompt",
                prompt=f"Considering my specific context, what are the primary trade-offs and alternative approaches to '{first_line}' when working with strict performance constraints and an existing production stack?",
            )
        )

    doc = AnalysisDocument(
        title=f"Interaction Diagnosis: {first_line}",
        blocks=blocks,
    )

    return AnalysisResult(
        request_id=request_id,
        analysis=doc,
    )


class Analyzer:
    """WDAIDT V0.6 Analysis Engine."""

    def __init__(self):
        self._client = None
        self._cached_key = None

    @property
    def api_key(self) -> str:
        return os.getenv("GEMINI_API_KEY", "").strip()

    @property
    def model_name(self) -> str:
        return os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite").strip()

    @property
    def is_mock(self) -> bool:
        # Mock mode is strictly opt-in via environment. A missing API key
        # surfaces as an honest 502, never as a silent mock success.
        mock_env = os.getenv("MOCK_ANALYSIS", "").lower()
        return mock_env in ("true", "1", "yes")

    def _get_client(self):
        if not self.api_key:
            raise AnalysisException(
                code="AI_PROVIDER_ERROR",
                message=(
                    "GEMINI_API_KEY is not configured. Set it in backend/.env, "
                    "or set MOCK_ANALYSIS=true for local testing without the API."
                ),
                status_code=502,
            )
        if self._client is None or self._cached_key != self.api_key:
            from google import genai
            self._client = genai.Client(api_key=self.api_key)
            self._cached_key = self.api_key
        return self._client

    async def _call_gemini_once(
        self,
        prompt: str,
        response: str,
        response_style: Optional[str] = None,
        custom_instructions: Optional[str] = None,
        analysis_depth: Optional[str] = None,
    ) -> str:
        """Execute one Gemini API call with 15s timeout and automatic model fallback."""
        client = self._get_client()
        system_instruction = compose_system_instructions(
            response_style=response_style,
            custom_instructions=custom_instructions,
            analysis_depth=analysis_depth,
        )
        user_prompt = build_analysis_user_prompt(prompt, response)

        # Candidates to try: configured model, then high-availability fallbacks
        candidates = [self.model_name]
        for fallback in ["gemini-3.5-flash-lite", "gemini-flash-latest"]:
            if fallback not in candidates:
                candidates.append(fallback)

        def _sync_call():
            last_client_error = None
            for model_candidate in candidates:
                try:
                    resp = client.models.generate_content(
                        model=model_candidate,
                        contents=user_prompt,
                        config={
                            "system_instruction": system_instruction,
                            "response_mime_type": "application/json",
                            "temperature": 0.2,
                        },
                    )
                    return resp.text
                except Exception as err:
                    err_msg = str(err)
                    # If 503 (high demand) or 404 (unavailable/retired), try next candidate
                    if "503" in err_msg or "UNAVAILABLE" in err_msg or "404" in err_msg:
                        last_client_error = err
                        continue
                    raise err
            if last_client_error:
                raise last_client_error
            raise RuntimeError("No Gemini models responded.")

        try:
            # 15s timeout per API agreement
            return await asyncio.wait_for(asyncio.to_thread(_sync_call), timeout=15.0)
        except asyncio.TimeoutError:
            raise AnalysisException(
                code="TIMEOUT",
                message="Gemini took too long.",
                status_code=504,
            )
        except Exception as e:
            logger.error("Gemini invocation failed: %s", str(e))
            raise AnalysisException(
                code="AI_PROVIDER_ERROR",
                message="Analysis failed. Please try again.",
                status_code=502,
            )

    async def analyze(
        self,
        prompt: str,
        response: str,
        request_id: Optional[str] = None,
        response_style: Optional[str] = None,
        custom_instructions: Optional[str] = None,
        analysis_depth: Optional[str] = None,
    ) -> AnalysisResult:
        """Run analysis on the prompt and response interaction."""
        if self.is_mock:
            return generate_mock_analysis(
                prompt=prompt,
                response=response,
                request_id=request_id,
                response_style=response_style,
                analysis_depth=analysis_depth,
            )

        # Retry once per agreement if output cannot be parsed or validated
        last_error = None
        for attempt in range(2):
            try:
                raw_text = await self._call_gemini_once(
                    prompt=prompt,
                    response=response,
                    response_style=response_style,
                    custom_instructions=custom_instructions,
                    analysis_depth=analysis_depth,
                )
                cleaned = _clean_json_text(raw_text)
                data = json.loads(cleaned)

                # Validate against document schema
                if isinstance(data, dict) and "analysis" in data and isinstance(data["analysis"], dict):
                    doc = AnalysisDocument.model_validate(data["analysis"])
                else:
                    doc = AnalysisDocument.model_validate(data)

                return AnalysisResult(
                    request_id=request_id,
                    analysis=doc,
                )
            except AnalysisException as ae:
                if ae.code == "TIMEOUT":
                    raise ae
                last_error = ae
            except Exception as e:
                logger.warning("Attempt %d parsing/validation error: %s", attempt + 1, str(e))
                last_error = AnalysisException(
                    code="AI_PROVIDER_ERROR",
                    message="Analysis failed. Please try again.",
                    status_code=502,
                )

        # Retries exhausted
        if last_error:
            raise last_error

        raise AnalysisException(
            code="AI_PROVIDER_ERROR",
            message="Analysis failed. Please try again.",
            status_code=502,
        )


# Global singleton analyzer
analyzer = Analyzer()
