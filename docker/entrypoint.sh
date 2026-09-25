#!/usr/bin/env bash
# Starts PostgreSQL (unless DATABASE_URL points elsewhere), runs migrations and seeding,
# then the FastAPI backend and the Next.js frontend. Exits if any process stops.
set -euo pipefail

APP_DIR="${APP_DIR:-/app}"
DATA_DIR="${DATA_DIR:-/data}"
PGDATA="${DATA_DIR}/postgres"
PG_SOCKET_DIR="${PG_SOCKET_DIR:-/run/postgresql}"
PORT="${PORT:-3000}"
log() { echo "[ssdlc] $*"; }

# Hosted volumes are often mounted root-owned. When started as root (e.g. `--user 0`), fix the
# ownership of the data directories and re-run this script as the unprivileged `app` user.
if [[ "$(id -u)" == 0 ]]; then
  mkdir -p "${DATA_DIR}" "${PG_SOCKET_DIR}"
  chown -R app:app "${DATA_DIR}" "${PG_SOCKET_DIR}"
  # Keep the environment (OAuth, API keys, ...) - only switch user.
  exec setpriv --reuid=app --regid=app --init-groups env HOME=/home/app bash "$0" "$@"
fi

mkdir -p "${DATA_DIR}" 2>/dev/null || true
if [[ ! -w "${DATA_DIR}" ]]; then
  log "ERROR: ${DATA_DIR} is not writable by $(id -un) (uid $(id -u))."
  log "       Fix the volume ownership (chown -R 10001:10001) or start the container as root once."
  exit 1
fi

# --- Shared auth secret (persisted so sessions survive restarts) --------------------------
if [[ -z "${AUTH_SECRET:-}" ]]; then
  if [[ ! -s "${DATA_DIR}/auth_secret" ]]; then
    head -c 48 /dev/urandom | base64 | tr -d '\n=' > "${DATA_DIR}/auth_secret"
    chmod 600 "${DATA_DIR}/auth_secret"
    log "Generated AUTH_SECRET and stored it in ${DATA_DIR}/auth_secret"
  fi
  AUTH_SECRET="$(cat "${DATA_DIR}/auth_secret")"
fi
export AUTH_SECRET

# --- Database ------------------------------------------------------------------------------
PG_STARTED=0
if [[ -z "${DATABASE_URL:-}" ]]; then
  if [[ ! -s "${PGDATA}/PG_VERSION" ]]; then
    log "Initialising embedded PostgreSQL in ${PGDATA}"
    initdb --pgdata="${PGDATA}" --username=app --auth=trust --encoding=UTF8 --no-instructions >/dev/null
    {
      echo "listen_addresses = '127.0.0.1'"
      echo "unix_socket_directories = '${PG_SOCKET_DIR}'"
    } >> "${PGDATA}/postgresql.conf"
  fi
  pg_ctl --pgdata="${PGDATA}" --log="${DATA_DIR}/postgres.log" --wait --timeout=60 start >/dev/null
  PG_STARTED=1
  until pg_isready --host=127.0.0.1 --quiet; do sleep 0.5; done
  if ! psql --host=127.0.0.1 --username=app --dbname=postgres -tAc "SELECT 1 FROM pg_database WHERE datname='ssdlc'" | grep -q 1; then
    createdb --host=127.0.0.1 --username=app ssdlc
  fi
  export DATABASE_URL="postgresql://app@127.0.0.1:5432/ssdlc"
  log "Embedded PostgreSQL is ready"
else
  log "Using external database from DATABASE_URL"
fi

stop_all() {
  trap - TERM INT
  log "Shutting down"
  kill -TERM "${API_PID:-}" "${WEB_PID:-}" 2>/dev/null || true
  wait 2>/dev/null || true
  if [[ "${PG_STARTED}" == 1 ]]; then
    pg_ctl --pgdata="${PGDATA}" --mode=fast stop >/dev/null 2>&1 || true
  fi
}
trap 'stop_all; exit 0' TERM INT

# --- Migrations + framework catalogue --------------------------------------------------------
cd "${APP_DIR}/backend"
alembic upgrade head
python -m scripts.seed

# --- Sign-in check -----------------------------------------------------------------------------
if [[ -z "${AUTH_GITHUB_ID:-}" && -z "${AUTH_GOOGLE_ID:-}" && "${ENABLE_DEV_LOGIN:-}" != "true" ]]; then
  log "WARNING: no sign-in method configured. Set AUTH_GITHUB_ID/AUTH_GITHUB_SECRET (or Google),"
  log "         or ENABLE_DEV_LOGIN=true for a private trial (it trusts any e-mail address)."
fi
if [[ "${ENABLE_DEV_LOGIN:-}" == "true" ]]; then
  log "WARNING: ENABLE_DEV_LOGIN=true - anyone who can reach this site can sign in as any e-mail."
fi

# --- Backend (internal only) -------------------------------------------------------------------
export CORS_ORIGINS="${CORS_ORIGINS:-${AUTH_URL:-http://localhost:${PORT}}}"
uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers --no-server-header &
API_PID=$!

# --- Frontend (public) -------------------------------------------------------------------------
cd "${APP_DIR}/web"
HOSTNAME=0.0.0.0 PORT="${PORT}" node server.js &
WEB_PID=$!
log "Listening on http://0.0.0.0:${PORT}"

# Exit (so the orchestrator restarts us) as soon as either process dies.
set +e
wait -n "${API_PID}" "${WEB_PID}"
STATUS=$?
log "A process exited with status ${STATUS}"
stop_all
exit "${STATUS:-1}"
