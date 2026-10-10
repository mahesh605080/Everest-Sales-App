import subprocess
import sys

import pytest
from pydantic import ValidationError

from app.config import DEV_SECRET, Settings


def test_alive(client):
    r = client.get("/api/v1/health")
    assert r.status_code == 200 and r.json()["ok"] is True


def test_ready_reports_both_migration_tracks(client):
    r = client.get("/api/v1/health/ready")
    body = r.json()
    assert r.status_code == 200, body
    assert body["database"] == "ok" and body["migrations"]["platform"]["up_to_date"] is True
    assert body["migrations"]["web"]["last_applied"].startswith("024_")  # the web app's tables are present and untouched


def test_every_response_has_request_id_and_security_headers(client):
    r = client.get("/api/v1/health")
    assert len(r.headers["x-request-id"]) == 16
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["x-frame-options"] == "DENY" and r.headers["cache-control"] == "no-store"


def test_unknown_route_uses_the_common_error_shape(client):
    r = client.get("/api/v1/nope")
    assert r.status_code == 404 and r.json()["code"] == "not_found" and isinstance(r.json()["error"], str) and r.json()["request_id"]


def test_oversized_body_is_refused(client):
    r = client.post("/api/v1/health", content=b"x" * (1_048_576 + 10))
    assert r.status_code == 413 and r.json()["code"] == "too_large"


def test_production_refuses_a_weak_secret():
    with pytest.raises(ValidationError):
        Settings(PLATFORM_ENV="production", DATABASE_URL="postgresql://x/y", AUTH_SECRET=DEV_SECRET)
    with pytest.raises(ValidationError):
        Settings(PLATFORM_ENV="production", DATABASE_URL="postgresql://x/y", AUTH_SECRET="short")
    ok = Settings(PLATFORM_ENV="production", DATABASE_URL="postgres://u:p@h/db", AUTH_SECRET="a" * 40)
    assert ok.database_url.startswith("postgresql+psycopg://") and ok.problems() == ["SMTP is not configured: password reset works only through an administrator"]


def test_configuration_problems_never_show_the_secret():
    s = Settings(PLATFORM_ENV="development", DATABASE_URL="postgresql://x/y", AUTH_SECRET="tooshort-but-secret")
    assert any("shorter" in p for p in s.problems()) and "tooshort-but-secret" not in " ".join(s.problems())


def test_platform_owns_only_its_own_schema(sql):
    owned = {r[0] for r in sql("select table_schema from information_schema.tables where table_name in ('settings','alembic_version') and table_schema='platform'")}
    assert owned == {"platform"}
    assert sql("select count(*) from information_schema.tables where table_schema='public'").scalar() == 46  # exactly what the web app created


def test_migrations_can_be_rolled_back_and_reapplied(sql):
    run = lambda *a: subprocess.run([sys.executable, "-m", "alembic", *a], check=True, capture_output=True)  # noqa: E731
    run("downgrade", "base")
    assert sql("select to_regclass('platform.settings')").scalar() is None
    assert sql("select count(*) from public.users").scalar() > 0  # business data is not touched by a platform rollback
    run("upgrade", "head")
    assert sql("select to_regclass('platform.settings')").scalar() is not None
