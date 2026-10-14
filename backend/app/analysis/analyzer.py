"""Core analysis engine for WDAIDT.

Transforms (Prompt + AI Response) into structured insights:
- why
- influences
- assumptions
- what_could_change

Supports Gemini API with one automatic retry, 15s timeout, and mock fallback.
"""

import asyncio
import json
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

from app.analysis.prompts import ANALYSIS_SYSTEM_PROMPT, build_analysis_user_prompt
from app.models.analysis import AnalysisResult
from app.models.exceptions import AnalysisException


def _clean_json_text(raw_text: str) -> str:
    """Extract raw JSON substring from LLM response if wrapped in code blocks."""
    cleaned = raw_text.strip()
    match = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", cleaned)
    if match:
        cleaned = match.group(1).strip()
    return cleaned


def generate_mock_analysis(prompt: str, response: str, request_id: Optional[str] = None) -> AnalysisResult:
    """Generate realistic mock analysis conforming strictly to the API agreement."""
    clean_p = prompt.strip()
    first_line = clean_p.split("\n")[0][:120] if clean_p else "the question"

    return AnalysisResult(
        request_id=request_id,
        why=f"The question appears to be interpreted as asking about {first_line.lower()}.",
        influences=[
            "The direct phrasing and scope of the prompt appear to have guided the response.",
            "Common domain best practices likely influenced the specific recommendations.",
        ],
        assumptions=[
            "The prompt seems to assume standard tooling and current industry practices.",
            "The interaction appears to focus on the immediate scope without prior context.",
        ],
        what_could_change=[
            "Specific constraints like budget, timeline, or skill level could change the advice.",
            "Specifying an alternate platform or environment could produce a different recommendation.",
        ],
    )


class Analyzer:
    """WDAIDT Analysis Engine."""

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
        mock_env = os.getenv("MOCK_ANALYSIS", "").lower()
        return mock_env in ("true", "1", "yes") or not self.api_key

    def _get_client(self):
        if not self.api_key:
            raise AnalysisException(
                code="AI_PROVIDER_ERROR",
                message="GEMINI_API_KEY is not configured.",
                status_code=502,
            )
        if self._client is None or self._cached_key != self.api_key:
            from google import genai
            self._client = genai.Client(api_key=self.api_key)
            self._cached_key = self.api_key
        return self._client


    async def _call_gemini_once(self, prompt: str, response: str) -> str:
        """Execute one Gemini API call with 15s timeout and automatic model fallback on 503/404."""
        client = self._get_client()
        user_prompt = build_analysis_user_prompt(prompt, response)

        # Candidates to try: primary model, then high-availability fallbacks
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
                            "system_instruction": ANALYSIS_SYSTEM_PROMPT,
                            "response_mime_type": "application/json",
                            "temperature": 0.2,
                        },
                    )
                    return resp.text
                except Exception as err:
                    err_msg = str(err)
                    # If 503 (high demand) or 404 (unavailable/retired), try next candidate model
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
        except Exception:
            raise AnalysisException(
                code="AI_PROVIDER_ERROR",
                message="Analysis failed. Please try again.",
                status_code=502,
            )



    async def analyze(
        self, prompt: str, response: str, request_id: Optional[str] = None
    ) -> AnalysisResult:
        """Run analysis on the prompt and response interaction."""
        if self.is_mock:
            return generate_mock_analysis(prompt, response, request_id)

        # Retry once per agreement if output cannot be parsed
        last_error = None
        for attempt in range(2):
            try:
                raw_text = await self._call_gemini_once(prompt, response)
                cleaned = _clean_json_text(raw_text)
                data = json.loads(cleaned)

                return AnalysisResult(
                    request_id=request_id,
                    why=str(data.get("why", "")).strip(),
                    influences=[str(x).strip() for x in data.get("influences", []) if str(x).strip()],
                    assumptions=[str(x).strip() for x in data.get("assumptions", []) if str(x).strip()],
                    what_could_change=[str(x).strip() for x in data.get("what_could_change", []) if str(x).strip()],
                )
            except AnalysisException as ae:
                if ae.code == "TIMEOUT":
                    raise ae
                last_error = ae
            except (json.JSONDecodeError, ValueError, KeyError) as e:
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
