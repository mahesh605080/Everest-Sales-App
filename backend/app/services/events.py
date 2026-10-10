import json
import re

from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import SCHEMA
from ..deps import Principal
from ..models.data import Collection

MAX_PAYLOAD = 8192
REPLAY_LIMIT = 500
_CH = re.compile(r"^(all|user:\d+|role:[a-z_]+|area:\d+|region:\d+|data:[a-z][a-z0-9_]{1,39})$")


def emit(db: Session, channel: str, type_: str, payload: dict | None = None, dedupe_key: str | None = None) -> int | None:
    """Write an event in the caller's transaction. It reaches subscribers only if that transaction commits."""
    body = json.dumps(payload or {}, default=str)
    if len(body.encode()) > MAX_PAYLOAD:
        raise ValueError("event payload too large")
    return db.execute(text(f"insert into {SCHEMA}.events(channel, type, payload, dedupe_key) values (:c, :t, cast(:p as jsonb), :k) on conflict (dedupe_key) do nothing returning id"),  # noqa: S608
                      {"c": channel, "t": type_, "p": body, "k": dedupe_key}).scalar()


def may_subscribe(db: Session, p: Principal, channel: str) -> bool:
    """Who may listen to what. Checked on the server for every subscription; a channel name the rules do not know is refused."""
    if not _CH.match(channel or ""):
        return False
    kind, _, arg = channel.partition(":")
    if kind == "all":
        return True
    if kind == "user":
        return int(arg) == p.id
    if kind == "role":
        return arg == p.role or p.is_super
    if kind == "area":
        return p.level >= 4 or (p.area_id is not None and int(arg) == p.area_id) or (p.level == 3 and p.region_id is not None and bool(
            db.execute(text("select 1 from public.areas where id = :a and region_id = :r"), {"a": int(arg), "r": p.region_id}).first()))
    if kind == "region":
        return p.level >= 4 or (p.region_id is not None and int(arg) == p.region_id)
    if kind == "data":
        from .documents import can_read_all
        c = db.get(Collection, arg)
        return bool(c and c.active and c.realtime and can_read_all(c, p))
    return False


def replay(db: Session, channel: str, since: int) -> list[dict]:
    rows = db.execute(text(f"select id, channel, type, payload, created_at from {SCHEMA}.events where channel = :c and id > :s order by id limit :l"),  # noqa: S608
                      {"c": channel, "s": since, "l": REPLAY_LIMIT}).mappings().all()
    return [wire(r) for r in rows]


def last_id(db: Session) -> int:
    return int(db.execute(text(f"select coalesce(max(id), 0) from {SCHEMA}.events")).scalar_one())  # noqa: S608


def wire(r) -> dict:
    return {"type": "event", "id": r["id"], "channel": r["channel"], "event": r["type"], "payload": r["payload"], "at": r["created_at"].isoformat()}
