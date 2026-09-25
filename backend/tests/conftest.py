"""Test fixtures. Runs against SQLite by default, or Postgres when TEST_DATABASE_URL is set
(CI runs both). The schema is always built through the Alembic migrations."""

from __future__ import annotations

import os
import tempfile
import time
from collections.abc import Iterator
from pathlib import Path

import jwt
import pytest

AUTH_SECRET = "test-secret-for-hs256-signing-0123456789abcdef"
_TMP = tempfile.mkdtemp(prefix="ssdlc-test-")
DB_URL = os.environ.get("TEST_DATABASE_URL") or f"sqlite:///{_TMP}/test.db"

os.environ.update(
    AUTH_SECRET=AUTH_SECRET,
    DATABASE_URL=DB_URL,
    CORS_ORIGINS="http://localhost:3000,https://app.example.com",
    ANTHROPIC_API_KEY="",
)

from alembic import command  # noqa: E402
from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.db import Base, get_engine, reset_engine  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services.frameworks import seed_frameworks  # noqa: E402

BACKEND = Path(__file__).resolve().parents[1]
TENANT_TABLES = [
    "audit_log", "score_overrides", "practice_assessments", "analysis_runs", "chunks", "documents",
    "engagement_frameworks", "engagements", "report_templates", "invitations", "users", "organizations",
]


@pytest.fixture(scope="session", autouse=True)
def _database() -> Iterator[None]:
    get_settings.cache_clear()
    engine = reset_engine(get_settings().database_url)
    cfg = Config(str(BACKEND / "alembic.ini"))
    cfg.set_main_option("script_location", str(BACKEND / "alembic"))
    cfg.attributes["database_url"] = get_settings().database_url
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public"))
    command.upgrade(cfg, "head")
    from app.db import get_db

    gen = get_db()
    seed_frameworks(next(gen))
    gen.close()
    yield
    engine.dispose()


@pytest.fixture(autouse=True)
def _clean_tables() -> Iterator[None]:
    yield
    engine = get_engine()
    with engine.begin() as conn:
        for t in TENANT_TABLES:
            conn.execute(text(f"DELETE FROM {t}"))


@pytest.fixture()
def settings(monkeypatch):
    get_settings.cache_clear()
    yield get_settings()
    get_settings.cache_clear()


@pytest.fixture()
def app():
    return create_app()


@pytest.fixture()
def client(app) -> TestClient:
    return TestClient(app)


def make_token(email: str, name: str | None = None, *, secret: str = AUTH_SECRET, lifetime: int = 900,
               iat_offset: int = 0, audience: str = "ssdlc-api", issuer: str = "ssdlc-frontend") -> str:
    now = int(time.time()) + iat_offset
    claims = {"sub": email, "email": email, "iat": now, "exp": now + lifetime, "aud": audience, "iss": issuer}
    if name:
        claims["name"] = name
    return jwt.encode(claims, secret, algorithm="HS256")


def auth(email: str, name: str | None = None) -> dict[str, str]:
    return {"Authorization": f"Bearer {make_token(email, name)}"}


@pytest.fixture()
def alice(client) -> dict[str, str]:
    """Admin of organization A (first sign-in provisions a personal org)."""
    h = auth("alice@acme.test", "Alice")
    assert client.get("/api/me", headers=h).status_code == 200
    return h


@pytest.fixture()
def mallory(client) -> dict[str, str]:
    """Admin of a different organization."""
    h = auth("mallory@evil.test", "Mallory")
    assert client.get("/api/me", headers=h).status_code == 200
    return h


SAMPLE_EVIDENCE = """# Acme Payments SDLC overview

## Governance
The application security program has a charter owned by the CISO and a two-year roadmap.
Security policy and secure coding standard documents are published and reviewed annually.
Metrics such as mean time to remediate are reported monthly on a dashboard.

## Design
Threat modeling with STRIDE is performed for new features using data flow diagrams.
Security requirements are derived from OWASP ASVS and added as acceptance criteria.

## Build and test
Every pull request requires peer code review and CODEOWNERS approval.
SAST with Semgrep runs automatically in the GitHub Actions pipeline and blocks merges on high findings.
Dependabot raises dependency updates; SCA findings are tracked in Jira with SLAs.
Secrets are stored in HashiCorp Vault and gitleaks secret scanning runs on every commit.
We do not yet produce an SBOM, and there is no DAST or penetration test programme.

## Operations
Logs are centralised in Splunk (SIEM) with alerting on authentication failures.
An incident response playbook exists but tabletop exercises are ad hoc.
"""


@pytest.fixture()
def engagement(client, alice) -> dict:
    r = client.post("/api/engagements", headers=alice, json={
        "client_name": "Acme", "app_name": "Payments", "scope": "Payments API and web app",
        "frameworks": [{"key": "samm"}, {"key": "nist_ssdf", "target": 2.5}, {"key": "nist_csf"}],
    })
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture()
def engagement_with_evidence(client, alice, engagement) -> dict:
    files = {"file": ("sdlc-overview.md", SAMPLE_EVIDENCE.encode(), "text/markdown")}
    r = client.post(f"/api/engagements/{engagement['id']}/documents", headers=alice, files=files)
    assert r.status_code == 201, r.text
    r = client.post(f"/api/engagements/{engagement['id']}/interviews", headers=alice, json={
        "title": "Interview with lead developer", "interviewee_role": "Lead developer",
        "interview_date": "2026-09-01",
        "notes": "Contact me at dev.lead@acme.test or +1 (555) 123-4567.\n\n"
                 "We run SonarQube static analysis but it does not block the build.\n"
                 "Container images are scanned with Trivy before deployment to Kubernetes.",
    })
    assert r.status_code == 201, r.text
    return engagement


def run_analysis(client, headers, engagement_id: str, framework_key: str) -> dict:
    r = client.post(f"/api/engagements/{engagement_id}/analysis/runs", headers=headers,
                    json={"framework_key": framework_key})
    assert r.status_code == 201, r.text
    run = r.json()
    for d in run["domains"]:
        r = client.post(f"/api/engagements/{engagement_id}/analysis/runs/{run['id']}/domains/{d['id']}",
                        headers=headers)
        assert r.status_code == 200, r.text
    return r.json()["run"]


__all__ = ["Base", "auth", "make_token", "run_analysis", "SAMPLE_EVIDENCE"]
