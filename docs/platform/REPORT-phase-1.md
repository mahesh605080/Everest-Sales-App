# Phase 1 report — backend foundation

**Status: complete and tested.**

1. **Features.** A Python service (FastAPI) in `backend/`, beside the web app and on the same PostgreSQL. Configuration from environment variables only, with a refusal to start in production on a weak `AUTH_SECRET`. Liveness and readiness endpoints; readiness reports both migration tracks. One error shape for every response (the same as the web API). Request id, body-size limit, security headers and one structured JSON log line per request, with secret-looking fields hidden. Alembic migrations confined to a new schema, `platform`.
2. **Existing files modified.** `docker-compose.yml` (adds the `platform` service and a file volume; Caddy now reads a `Caddyfile`), `.env.example` (new variables), `next.config.mjs` (passes `/api/v1/*` to the platform service when there is no reverse proxy).
3. **New files.** `backend/` (`app/`, `migrations/`, `tests/`, `scripts/test.sh`, `Dockerfile`, `requirements*.txt`, `pyproject.toml`, `alembic.ini`), `Caddyfile`, `docs/platform/`.
4. **Migrations.** `0001_foundation` (schema `platform`, table `platform.settings`). Applied and rolled back and re-applied in the tests. No change to any existing table.
5. **Tests run.** `backend/scripts/test.sh`: 9 passed. Linter (`ruff`): clean. The service was also started with uvicorn and its endpoints called over HTTP.
6. **Existing versus new failures.** None of either. Web suite before the phase: 157/157.
7. **Security controls verified by test.** Production refuses a weak secret; configuration warnings never contain the secret; oversized bodies get 413; security headers on every response; errors never leak internals; a platform rollback leaves business data untouched.
8. **Limitations.** The Docker and Caddy files have not been run (no Docker where this was written). The service runs one process; that is deliberate until realtime is designed for several (Phase 4).
9. **Configuration needed.** `DATABASE_URL`, `AUTH_SECRET` (the same values the web app uses). Optional: `CORS_ORIGINS`, `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`, `PLATFORM_URL`.
10. **Commands.**
    ```bash
    cd backend
    python3 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt
    DATABASE_URL=postgresql://... AUTH_SECRET=... .venv/bin/python -m alembic upgrade head
    DATABASE_URL=postgresql://... AUTH_SECRET=... .venv/bin/uvicorn app.main:app --port 8000
    PG_ADMIN_URL=postgresql://postgres@localhost:5432/postgres ./scripts/test.sh     # tests, on a throw-away database
    ```
11. **Next.** Phase 2, authentication. Depends on nothing outside the repository.
