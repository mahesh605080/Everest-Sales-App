from alembic.config import Config
from alembic.script import ScriptDirectory
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SCHEMA, get_db
from ..paths import ALEMBIC_INI

router = APIRouter(tags=["health"])


def head_revision() -> str | None:
    return ScriptDirectory.from_config(Config(str(ALEMBIC_INI))).get_current_head()


def migration_status(db: Session) -> dict:
    """Both migration tracks: the platform's own (Alembic) and the web app's numbered SQL files."""
    has = db.execute(text("select to_regclass(:t)"), {"t": f"{SCHEMA}.alembic_version"}).scalar()
    current = db.execute(text(f"select version_num from {SCHEMA}.alembic_version")).scalar() if has else None  # noqa: S608 constant schema name
    web = db.execute(text("select to_regclass('public.schema_migrations')")).scalar()
    web_last = db.execute(text("select max(name) from public.schema_migrations")).scalar() if web else None
    head = head_revision()
    return {"platform": {"current": current, "head": head, "up_to_date": current == head}, "web": {"last_applied": web_last}}


@router.get("/health", summary="Is the process alive")
def live():
    return {"ok": True, "service": "everest-platform", "env": get_settings().env}


@router.get("/health/ready", summary="Can it serve requests: database reachable and migrations applied")
def ready(db: Session = Depends(get_db)):
    try:
        db.execute(text("select 1"))
        mig = migration_status(db)
    except Exception:
        return JSONResponse({"ok": False, "database": "unreachable"}, status_code=503)
    ok = mig["platform"]["up_to_date"]
    return JSONResponse({"ok": ok, "database": "ok", "migrations": mig}, status_code=200 if ok else 503)
