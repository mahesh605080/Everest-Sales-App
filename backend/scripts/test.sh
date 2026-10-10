#!/usr/bin/env bash
# Runs the platform tests against a throw-away database that also has the web app's tables and sample data.
# Needs a PostgreSQL superuser connection in PG_ADMIN_URL, e.g. postgresql://postgres@localhost:5432/postgres
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN="${PG_ADMIN_URL:?set PG_ADMIN_URL to a superuser connection}"
NAME="${TEST_DB_NAME:-sfa_platform_test}"
psql "$ADMIN" -q -c "drop database if exists $NAME with (force)" -c "create database $NAME" >/dev/null
export DATABASE_URL="$(python3 - "$ADMIN" "$NAME" <<'PY'
import sys, urllib.parse as u
p = u.urlsplit(sys.argv[1]); print(u.urlunsplit((p.scheme, p.netloc, "/" + sys.argv[2], p.query, "")))
PY
)"
export AUTH_SECRET="test-secret-0123456789abcdef0123456789abcdef" PLATFORM_ENV=test PLATFORM_WORKER=0
(cd .. && npm run -s migrate >/dev/null && npm run -s seed -- --sample >/dev/null)   # the web app's own tables and sample people
PY="${PYTHON:-.venv/bin/python}"
"$PY" -m alembic upgrade head
"$PY" -m pytest "$@"
