"""Main application entry point for WDAIDT Backend."""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from backend/.env or current working directory
backend_env = Path(__file__).resolve().parent.parent / ".env"
if backend_env.exists():
    load_dotenv(dotenv_path=backend_env)
else:
    load_dotenv()

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.analyze import router as analyze_router
from app.models.exceptions import AnalysisException



app = FastAPI(
    title="Why Did AI Do That? (WDAIDT) API",
    description="Backend service providing AI response debugging and explanation.",
    version="1.0.0",
)

# CORS configuration per API agreement
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allows chrome-extension:// origins and localhost
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(AnalysisException)
async def analysis_exception_handler(_request: Request, exc: AnalysisException):
    """Handle deliberate domain/analysis errors per agreed envelope."""
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": exc.code, "message": exc.message}},
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(_request: Request, _exc: RequestValidationError):
    """Override FastAPI default 422 to conform to agreed error shape."""
    return JSONResponse(
        status_code=422,
        content={
            "error": {
                "code": "INVALID_REQUEST",
                "message": "Missing/empty prompt or response, wrong types",
            }
        },
    )


@app.exception_handler(StarletteHTTPException)
async def http_exception_handler(_request: Request, exc: StarletteHTTPException):
    """Handle standard HTTP exceptions with unified error envelope."""
    code = "INTERNAL"
    if exc.status_code == 404:
        code = "NOT_FOUND"
    elif exc.status_code == 405:
        code = "METHOD_NOT_ALLOWED"
    elif exc.status_code == 413:
        code = "PAYLOAD_TOO_LARGE"
    elif exc.status_code == 422:
        code = "INVALID_REQUEST"
    elif exc.status_code == 429:
        code = "RATE_LIMITED"

    return JSONResponse(
        status_code=exc.status_code,
        content={"error": {"code": code, "message": str(exc.detail)}},
        headers=getattr(exc, "headers", None),
    )


@app.exception_handler(Exception)
async def generic_exception_handler(_request: Request, _exc: Exception):
    """Catch-all unhandled exception handler."""
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "code": "INTERNAL",
                "message": "An unexpected error occurred.",
            }
        },
    )


# Register API routes
app.include_router(analyze_router)


if __name__ == "__main__":
    import uvicorn

    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", "8000"))
    uvicorn.run("app.main:app", host=host, port=port, reload=True)
