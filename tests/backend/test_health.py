"""Tests for GET /health endpoint."""

import sys
import os
from pathlib import Path

# Add backend directory to sys.path
backend_dir = Path(__file__).resolve().parent.parent.parent / "backend"
sys.path.insert(0, str(backend_dir))

from fastapi.testclient import TestClient
from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    """Verify health endpoint responds with 200 and status ok."""
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data == {"status": "ok"}


def test_app_version_is_v1_0_0():
    """Verify backend FastAPI application version metadata is synchronized to 1.0.0."""
    assert app.version == "1.0.0"
