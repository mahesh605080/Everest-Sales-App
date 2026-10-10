from datetime import datetime, time

from sqlalchemy import BigInteger, Boolean, DateTime, Index, Integer, SmallInteger, String, Time, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..db import SCHEMA, Base

TS = DateTime(timezone=True)


class Job(Base):
    """One piece of background work. `kind` names a function registered in the code; nothing else can be run.
    queued -> running -> done · failed attempts go back to queued with a pause · dead after the last attempt · cancelled by an administrator."""
    __tablename__ = "jobs"
    __table_args__ = (Index("jobs_due", "status", "run_at"),
                      # The same piece of work cannot wait or run twice at once.
                      Index("jobs_dedupe", "dedupe_key", unique=True, postgresql_where=text("status in ('queued', 'running')")), {"schema": SCHEMA})
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    status: Mapped[str] = mapped_column(String(10), default="queued")
    priority: Mapped[int] = mapped_column(SmallInteger, default=5)
    run_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    max_attempts: Mapped[int] = mapped_column(Integer, default=3)
    dedupe_key: Mapped[str | None] = mapped_column(String(120))
    schedule: Mapped[str | None] = mapped_column(String(60))  # the schedule that made it, if any
    started_at: Mapped[datetime | None] = mapped_column(TS)
    finished_at: Mapped[datetime | None] = mapped_column(TS)
    last_error: Mapped[str | None] = mapped_column(String(500))
    result: Mapped[dict | None] = mapped_column(JSONB)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class Schedule(Base):
    """Work that repeats: every so many seconds, or once a day at a Nepal-time clock time."""
    __tablename__ = "schedules"
    __table_args__ = {"schema": SCHEMA}
    name: Mapped[str] = mapped_column(String(60), primary_key=True)
    label: Mapped[str] = mapped_column(String(200))
    kind: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    every_seconds: Mapped[int | None] = mapped_column(Integer)
    daily_at: Mapped[time | None] = mapped_column(Time)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    next_run_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    last_run_at: Mapped[datetime | None] = mapped_column(TS)
    last_status: Mapped[str | None] = mapped_column(String(10))
    last_job_id: Mapped[int | None] = mapped_column(BigInteger)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class Alert(Base):
    """Something the monitor found wrong. One open row per rule; it closes by itself when the rule stops firing."""
    __tablename__ = "alerts"
    __table_args__ = (Index("alerts_open", "rule", unique=True, postgresql_where=text("resolved_at is null")), {"schema": SCHEMA})
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rule: Mapped[str] = mapped_column(String(60))
    severity: Mapped[str] = mapped_column(String(8))  # warning | critical
    message: Mapped[str] = mapped_column(String(300))
    detail: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    count: Mapped[int] = mapped_column(Integer, default=1)
    first_seen_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    resolved_at: Mapped[datetime | None] = mapped_column(TS)
    acknowledged_by: Mapped[int | None] = mapped_column(Integer)
    acknowledged_at: Mapped[datetime | None] = mapped_column(TS)
