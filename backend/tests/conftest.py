import os

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

# scripts/test.sh prepares the database and sets DATABASE_URL before pytest starts.
assert os.environ.get("PLATFORM_ENV") == "test", "run the tests with backend/scripts/test.sh, never against real data"

from app.db import session_factory  # noqa: E402
from app.main import create_app  # noqa: E402


@pytest.fixture(scope="session")
def app():
    return create_app()


@pytest.fixture()
def client(app):
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def db():
    s = session_factory()()
    try:
        yield s
        s.commit()
    finally:
        s.close()


@pytest.fixture()
def sql(db):
    def run(q: str, **params):
        r = db.execute(text(q), params)
        db.commit()
        return r
    return run


@pytest.fixture()
def as_user(client, sql):
    """Authorization headers for a sample person. The Super Admin's temporary-password flag is cleared for the tests."""
    from tests.helpers import token
    sql("update public.users set must_change_password = false, failed_logins = 0, locked_until = null, active = true where code = 'ADMIN'")
    sql("delete from platform.rate_limits")
    cache: dict = {}

    def get(code: str):
        if code not in cache:
            cache[code] = token(client, code)
        return cache[code]
    return get
