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
