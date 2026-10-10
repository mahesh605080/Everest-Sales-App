from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import get_settings

SCHEMA = "platform"  # everything this service owns lives here; the web app's tables stay in "public"


class Base(DeclarativeBase):
    pass


_engine = None
_Session: sessionmaker[Session] | None = None


def engine():
    global _engine, _Session
    if _engine is None:
        s = get_settings()
        _engine = create_engine(
            s.database_url, pool_size=s.db_pool_size, max_overflow=5, pool_pre_ping=True, pool_recycle=1800,
            connect_args={"options": f"-c statement_timeout={s.statement_timeout_ms} -c timezone=UTC -c application_name=everest-platform"},
        )
        _Session = sessionmaker(_engine, expire_on_commit=False)
    return _engine


def session_factory() -> sessionmaker[Session]:
    engine()
    assert _Session is not None
    return _Session


def get_db() -> Iterator[Session]:
    """One transaction per request: committed when the handler returns, rolled back if it raises."""
    db = session_factory()()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def ping() -> bool:
    with engine().connect() as c:
        return c.execute(text("select 1")).scalar() == 1


def dispose():
    global _engine, _Session
    if _engine is not None:
        _engine.dispose()
    _engine, _Session = None, None
