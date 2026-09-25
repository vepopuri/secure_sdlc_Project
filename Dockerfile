# syntax=docker/dockerfile:1.7
#
# SSDLC Assessment Platform - everything in one image:
#   Next.js frontend (public port 3000) + FastAPI backend (127.0.0.1:8000) + PostgreSQL (127.0.0.1:5432).
# The browser only talks to port 3000; /backend/* is rewritten to the API inside the container.
#
#   docker build -t ssdlc .
#   docker run -p 3000:3000 -v ssdlc-data:/data -e ENABLE_DEV_LOGIN=true ssdlc

ARG NODE_IMAGE=node:22-bookworm-slim
ARG PYTHON_IMAGE=python:3.12-slim-bookworm

# ---- 1. Build the Next.js app (standalone server) --------------------------------------
FROM ${NODE_IMAGE} AS web
WORKDIR /src/frontend
ENV NEXT_TELEMETRY_DISABLED=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
ARG NEXT_PUBLIC_BRAND_LOGO=""
ARG NEXT_PUBLIC_BRAND_NAME=""
ARG MAX_DIRECT_UPLOAD_MB=25
ENV NEXT_OUTPUT=standalone \
    NEXT_PUBLIC_API_URL=/backend \
    INTERNAL_API_URL=http://127.0.0.1:8000 \
    NEXT_PUBLIC_MAX_DIRECT_UPLOAD_MB=${MAX_DIRECT_UPLOAD_MB} \
    NEXT_PUBLIC_BRAND_LOGO=${NEXT_PUBLIC_BRAND_LOGO} \
    NEXT_PUBLIC_BRAND_NAME=${NEXT_PUBLIC_BRAND_NAME} \
    AUTH_SECRET=build-time-placeholder-not-used-at-runtime
RUN npm run build

# ---- 2. Runtime: Python + Node + PostgreSQL --------------------------------------------
FROM ${NODE_IMAGE} AS node
FROM ${PYTHON_IMAGE} AS runtime

ARG MAX_DIRECT_UPLOAD_MB=25
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    DATA_DIR=/data \
    MAX_DIRECT_UPLOAD_MB=${MAX_DIRECT_UPLOAD_MB} \
    AUTH_TRUST_HOST=true

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql postgresql-contrib tini curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# Put initdb / pg_ctl / pg_isready on PATH (Debian keeps them in a versioned directory).
RUN ln -s /usr/lib/postgresql/*/bin/* /usr/local/bin/ \
 && initdb --version

COPY --from=node /usr/local/bin/node /usr/local/bin/node

WORKDIR /app
COPY backend/requirements.txt backend/requirements.txt
RUN pip install -r backend/requirements.txt

COPY backend/ backend/
COPY --from=web /src/frontend/.next/standalone/ web/
COPY --from=web /src/frontend/.next/static/ web/.next/static/
COPY --from=web /src/frontend/public/ web/public/
COPY docker/entrypoint.sh /app/docker/entrypoint.sh

RUN useradd --create-home --uid 10001 app \
 && mkdir -p /data /run/postgresql \
 && chown -R app:app /data /run/postgresql /app \
 && chmod +x /app/docker/entrypoint.sh

USER app
VOLUME ["/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/backend/api/health" || exit 1

ENTRYPOINT ["/usr/bin/tini", "--", "/app/docker/entrypoint.sh"]
