from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import SCHEMA
from ..errors import ApiError

_HIT = text(f"""
    insert into {SCHEMA}.rate_limits(key, window_start, count) values (:k, now(), 1)
    on conflict (key) do update set
        count = case when {SCHEMA}.rate_limits.window_start < now() - make_interval(secs => :w) then 1 else {SCHEMA}.rate_limits.count + 1 end,
        window_start = case when {SCHEMA}.rate_limits.window_start < now() - make_interval(secs => :w) then now() else {SCHEMA}.rate_limits.window_start end
    returning count""")  # noqa: S608
_PEEK = text(f"select count from {SCHEMA}.rate_limits where key = :k and window_start >= now() - make_interval(secs => :w)")  # noqa: S608


def hit(db: Session, key: str, window_seconds: int) -> int:
    """Counts one event and returns how many there have been in the current window."""
    return int(db.execute(_HIT, {"k": key[:160], "w": window_seconds}).scalar_one())


def count(db: Session, key: str, window_seconds: int) -> int:
    return int(db.execute(_PEEK, {"k": key[:160], "w": window_seconds}).scalar() or 0)


def limit(db: Session, key: str, maximum: int, window_seconds: int, message: str):
    """Counts the call and refuses it once the limit for the window is passed."""
    if hit(db, key, window_seconds) > maximum:
        raise ApiError(429, message, "rate_limited")


def clear(db: Session, key: str):
    db.execute(text(f"delete from {SCHEMA}.rate_limits where key = :k"), {"k": key[:160]})  # noqa: S608
