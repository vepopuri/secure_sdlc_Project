# SSDLC Assessment Platform

Assessors run secure software development lifecycle (SSDLC) maturity assessments for client
applications. The platform ingests client documentation and interview notes, scores them
against security frameworks with the Claude API (or a free keyword heuristic), lets assessors
review and override every score, and generates a PowerPoint report.

**Frameworks:** NIST CSF 2.0 · OWASP SAMM 2.0 · NIST SSDF (SP 800-218) · BSIMM · OWASP ASVS 5.0 ·
SLSA 1.0 · ISO/IEC 27034 (structure and identifiers only; the text is copyrighted).

## Features

- **Engagements** with client, application / business unit, scope, status
  (draft → in progress → review → final) and per-framework target levels.
- **Evidence**: upload PDF, DOCX, PPTX, XLSX, MD, TXT, CSV, EML, YAML and JSON (larger than 4 MB
  through Vercel Blob client uploads), or write interview notes in the built-in editor (title,
  interviewee role, date). E-mail addresses and phone numbers are redacted automatically. Text is
  split into heading-aware chunks for full-text search (Postgres GIN index) and citation.
- **Framework catalogue** as YAML data files (`backend/frameworks/`): domains, practices,
  maturity scale and level criteria. Every practice maps to a shared taxonomy of 32 SSDLC
  capabilities, so frameworks you did not analyse are **projected** instantly.
- **AI analysis**: one job per framework domain, driven from the browser so each request fits
  within serverless time limits. Evidence goes in a prompt-cached block, marked as untrusted
  data; output must match a JSON schema (score, confidence, rationale, cited quotes, gaps,
  recommendations with priority and a 30/60/90-day horizon). Scores are clamped to the scale and
  citations whose quote is not found word for word in the cited chunk are dropped.
- **Review**: override any score with a written reason. Overrides live in their own table, so
  re-running an analysis never overwrites them. Every change is written to the audit log.
- **Visuals**: framework toggle, radar chart (current vs target per domain), practice heatmap,
  expandable practice cards.
- **PowerPoint**: a built-in branded deck, or a client `.pptx` template filled via tokens.
- **Security**: organization-scoped queries (other organizations' records return 404), roles
  (admin / assessor / viewer), upload type and size allow-list, zip-bomb checks, SSRF-safe Blob
  fetches, nonce-based CSP and security headers, 15-minute HS256 API tokens, no secrets in code.

## Architecture

```
frontend/   Next.js 16 (App Router, TypeScript), Tailwind CSS 4, TanStack Query, Recharts, Auth.js v5
backend/    FastAPI, SQLAlchemy 2, Alembic, python-pptx, pypdf, python-docx, openpyxl, Anthropic SDK
docs/       deploy-vercel.md - click-by-click deployment and troubleshooting
samples/    sample evidence for demos and the end-to-end test
```

- The browser signs in with Auth.js (GitHub / Google, plus a dev-only e-mail login).
- `GET /api/token` on the frontend exchanges the session for a **15-minute HS256 JWT** signed
  with the shared `AUTH_SECRET`; the backend verifies signature, issuer, audience and lifetime.
- The browser calls the FastAPI backend directly with that bearer token (CORS restricted to
  `CORS_ORIGINS`).
- Database: Neon Postgres in production, SQLite locally. Any `postgres://` / `postgresql://`
  URL is normalised to the psycopg 3 driver.

## Local development

Requirements: Python 3.11+, Node.js 20.9+.

```bash
# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
cp .env.example .env          # set AUTH_SECRET (and optionally ANTHROPIC_API_KEY)
alembic upgrade head && python -m scripts.seed
uvicorn app.main:app --reload --port 8000

# Frontend (second terminal)
cd frontend
npm install
cp .env.example .env.local    # same AUTH_SECRET; ENABLE_DEV_LOGIN=true
npm run dev
```

Open <http://localhost:3000>, sign in with any e-mail address via the development login, and
upload `samples/acme-secure-sdlc-overview.md`.

Without `ANTHROPIC_API_KEY` the keyword heuristic analyzer is used. With a key, the Claude API
analyzer runs with `ANTHROPIC_MODEL` (default `claude-opus-5`), adaptive thinking,
`ANTHROPIC_EFFORT` (default `medium`), structured JSON output and server-side refusal fallbacks
(`ANTHROPIC_FALLBACKS=false` to disable).

## Tests

```bash
cd backend && ruff check . && python -m pytest                   # SQLite
TEST_DATABASE_URL=postgresql://user:pw@localhost/test python -m pytest   # Postgres

cd frontend && npm run lint && npm run typecheck && npm run build
npm run test:e2e   # starts both servers; needs the backend venv active and a prior build
```

CI (`.github/workflows/ci.yml`) runs lint, pytest on SQLite and Postgres, typecheck, the Next.js
build and a Playwright journey: sign in → create engagement → upload evidence and interview →
run analysis → toggle frameworks → override a score → download the PowerPoint.

## Report templates

Upload a `.pptx` on the **Report** tab. Supported tokens:

- Text: `{{client_name}} {{app_name}} {{scope}} {{date}} {{executive_summary}} {{frameworks}}
  {{overall_maturity}} {{document_count}} {{interview_count}}`. Tokens split across formatting
  runs are handled, as are tokens in table cells.
- Blocks: a text box that contains **only** one of these tokens is replaced by a chart or table
  at the same position and size: `{{chart:<framework>}}`, `{{table:scores:<framework>}}`,
  `{{table:gaps}}`, `{{table:roadmap}}`. `<framework>` accepts a key or name (`samm`,
  `nist_ssdf`, `SSDF`, `asvs`, ...).

Download **Sample template** on the same tab for a working example.

## Adding or editing a framework

Add a YAML file to `backend/frameworks/` following the existing files (key, scale, domains,
practices with `capabilities` weights and optional `levels`). Every capability key must exist in
`capabilities.yaml`; `pytest` validates the files. Run the **DB migrate** workflow (or
`python -m scripts.seed`) to load the change.

## Branding

Colours follow the Deloitte palette (Green `#86BC25`, Green 6 `#26890D`, Green 7 `#046A38`,
black). The logo is not included: place the official file in `frontend/public/brand/` and set
`NEXT_PUBLIC_BRAND_LOGO` (see `frontend/public/brand/README.md`).

## Deployment

See [docs/deploy-vercel.md](docs/deploy-vercel.md).
