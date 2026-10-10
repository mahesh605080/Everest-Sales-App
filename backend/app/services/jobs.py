"""Background jobs. A job names a `kind`; each kind is a function registered here in the code, with the few numbers it accepts and their limits.
There is no way to run anything else: no SQL, no script, no command can be given through a job."""
import logging
from collections.abc import Callable
from dataclasses import dataclass, field
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SCHEMA
from ..errors import ApiError
from ..models.jobs import Job, Schedule

log = logging.getLogger("platform.jobs")
NPT = ZoneInfo("Asia/Kathmandu")
now = lambda: datetime.now(UTC)  # noqa: E731


class Skip(Exception):
    """Raised by a handler when there is nothing to do for a reason worth recording (not configured, for example). The job ends as done, with the reason."""


@dataclass
class Kind:
    fn: Callable[[Session, dict], dict]
    label: str
    params: dict[str, tuple[int, int, int]] = field(default_factory=dict)  # name -> (default, least, most); whole numbers only
    max_attempts: int = 3


KINDS: dict[str, Kind] = {}


def kind(name: str, label: str, max_attempts: int = 3, **params: tuple[int, int, int]):
    def wrap(fn):
        KINDS[name] = Kind(fn, label, params, max_attempts)
        return fn
    return wrap


def clean_payload(kind_name: str, payload: dict | None) -> dict:
    k = KINDS.get(kind_name)
    if k is None:
        raise ApiError(422, "There is no job of this kind.", "invalid_request")
    payload = payload or {}
    extra = set(payload) - set(k.params)
    if extra:
        raise ApiError(422, f"This job does not take '{sorted(extra)[0]}'.", "invalid_request")
    out = {}
    for name, (default, least, most) in k.params.items():
        v = payload.get(name, default)
        if isinstance(v, bool) or not isinstance(v, int) or not least <= v <= most:
            raise ApiError(422, f"'{name}' must be a whole number from {least} to {most}.", "invalid_request")
        out[name] = v
    return out


# ---------- the kinds ----------
def _del(db: Session, sql: str, **p) -> int:
    return db.execute(text(sql), p).rowcount or 0


@kind("files.purge_deleted", "Remove the contents of files deleted some days ago", older_than_days=(7, 1, 365))
def _purge_files(db: Session, p: dict) -> dict:
    from . import files
    return {"purged": files.purge_deleted(db, p["older_than_days"])}


@kind("events.prune", "Delete live-update events older than the replay window", keep_days=(14, 1, 365))
def _prune_events(db: Session, p: dict) -> dict:
    return {"deleted": _del(db, f"delete from {SCHEMA}.events where created_at < now() - make_interval(days => :d)", d=p["keep_days"])}  # noqa: S608


@kind("auth.cleanup", "Clear out expired logins, used reset codes and old login history", keep_days=(90, 7, 3650), history_days=(365, 30, 3650), idle_days=(7, 1, 90))
def _auth_cleanup(db: Session, p: dict) -> dict:
    return {
        # A browser login nobody has used for days is ended. Phone logins are left alone: they live on short tokens that are renewed.
        "idle_browser_logins": _del(db, f"update {SCHEMA}.sessions set revoked_at = now(), revoke_reason = 'idle' where client = 'web' and revoked_at is null and last_used_at < now() - make_interval(days => :d)", d=p["idle_days"]),  # noqa: S608
        "refresh_tokens": _del(db, f"delete from {SCHEMA}.refresh_tokens where expires_at < now() - interval '7 days'"),  # noqa: S608
        "reset_codes": _del(db, f"delete from {SCHEMA}.password_resets where expires_at < now() - interval '7 days'"),  # noqa: S608
        "rate_limits": _del(db, f"delete from {SCHEMA}.rate_limits where window_start < now() - interval '2 days'"),  # noqa: S608
        # A finished login is kept for a while so "where was I logged in" still makes sense, then removed with its tokens.
        "sessions": _del(db, f"delete from {SCHEMA}.sessions where coalesce(revoked_at, expires_at) < now() - make_interval(days => :d) and (revoked_at is not null or expires_at < now())", d=p["keep_days"]),  # noqa: S608
        "login_history": _del(db, f"delete from {SCHEMA}.login_events where at < now() - make_interval(days => :d)", d=p["history_days"]),  # noqa: S608
    }


@kind("notify.prune", "Delete old notification records and device registrations that were switched off long ago", keep_days=(90, 7, 3650))
def _prune_notify(db: Session, p: dict) -> dict:
    return {
        "notifications": _del(db, f"delete from {SCHEMA}.notifications where created_at < now() - make_interval(days => :d) and status in ('done', 'cancelled')", d=p["keep_days"]),  # noqa: S608
        "devices": _del(db, f"delete from {SCHEMA}.push_subscriptions where not active and coalesce(last_failure_at, last_success_at, created_at) < now() - make_interval(days => :d)", d=p["keep_days"]),  # noqa: S608
    }


@kind("jobs.prune", "Delete the history of finished jobs and closed alerts", keep_days=(14, 1, 365), failed_keep_days=(60, 1, 3650))
def _prune_jobs(db: Session, p: dict) -> dict:
    return {
        "finished": _del(db, f"delete from {SCHEMA}.jobs where status in ('done', 'cancelled') and finished_at < now() - make_interval(days => :d)", d=p["keep_days"]),  # noqa: S608
        "failed": _del(db, f"delete from {SCHEMA}.jobs where status = 'dead' and finished_at < now() - make_interval(days => :d)", d=p["failed_keep_days"]),  # noqa: S608
        "alerts": _del(db, f"delete from {SCHEMA}.alerts where resolved_at < now() - make_interval(days => :d)", d=p["failed_keep_days"]),  # noqa: S608
    }


@kind("monitor.check", "Check the health rules and raise or close alerts", max_attempts=1)
def _monitor(db: Session, p: dict) -> dict:
    from . import monitor
    return monitor.run(db)


@kind("web.alert_rules", "Ask the web app to check its field alert rules (late check-ins, visits outside the fence ...)", max_attempts=2)
def _web_alerts(db: Session, p: dict) -> dict:
    s = get_settings()
    if not s.web_cron_ready:
        raise Skip("WEB_INTERNAL_URL and CRON_SECRET are not both set")
    r = httpx.get(s.web_internal_url.rstrip("/") + "/api/cron/alerts", headers={"x-cron-key": s.cron_secret}, timeout=30, follow_redirects=False)  # the key travels in a header, so it is in no log line
    if r.status_code != 200:
        raise RuntimeError(f"the web app answered {r.status_code}")
    return {"ok": True}


# ---------- queueing ----------
def enqueue(db: Session, kind_name: str, payload: dict | None = None, *, run_at: datetime | None = None, dedupe_key: str | None = None, priority: int = 5, created_by: int | None = None,
            schedule: str | None = None) -> int | None:
    """Returns the new job's id, or None when the same work (same dedupe key) is already waiting or running."""
    import json
    clean = clean_payload(kind_name, payload)
    return db.execute(text(f"""insert into {SCHEMA}.jobs(kind, payload, status, priority, run_at, attempts, max_attempts, dedupe_key, schedule, created_by)
                               values (:k, cast(:p as jsonb), 'queued', :pr, coalesce(:at, now()), 0, :m, :d, :s, :u)
                               on conflict (dedupe_key) where status in ('queued', 'running') do nothing returning id"""),  # noqa: S608
                      {"k": kind_name, "p": json.dumps(clean), "pr": priority, "at": run_at, "m": KINDS[kind_name].max_attempts, "d": dedupe_key, "s": schedule, "u": created_by}).scalar()


def claim(db: Session) -> Job | None:
    j = db.scalar(select(Job).where(Job.status == "queued", Job.run_at <= now()).order_by(Job.priority, Job.run_at, Job.id).limit(1).with_for_update(skip_locked=True))
    if j:
        j.status, j.attempts, j.started_at, j.finished_at = "running", j.attempts + 1, now(), None
    db.commit()
    return j


def _backoff(attempt: int) -> timedelta:
    return timedelta(seconds=min(3600, 60 * 2 ** max(0, attempt - 1)))  # 1 min, 2, 4 ... an hour at most


def _finish(db: Session, job_id: int, status: str, result: dict | None, error: str | None, retry_at: datetime | None = None):
    """Writes the outcome with a plain UPDATE. If the record was removed while the work ran, nothing matches and nothing breaks."""
    db.expire_all()
    values: dict = {"status": status, "result": result, "last_error": error}
    values.update({"run_at": retry_at} if retry_at else {"finished_at": now()})
    schedule = db.execute(update(Job).where(Job.id == job_id).values(**values).returning(Job.schedule)).first()
    if schedule and schedule[0]:
        db.execute(update(Schedule).where(Schedule.name == schedule[0]).values(last_status="retrying" if retry_at else status, last_run_at=now()))
    db.commit()


def run_one(db: Session) -> dict | None:
    """Takes the next due job and runs it. Its work and its result are separate transactions: a failure undoes the work, never the record of the failure."""
    j = claim(db)
    if j is None:
        return None
    jid, kind_name, payload, attempts, most = j.id, j.kind, j.payload, j.attempts, j.max_attempts   # plain values: the record itself may be gone by the time the work ends
    k = KINDS.get(kind_name)
    try:
        if k is None:
            raise LookupError("no such kind of job in this version")
        db.execute(text("set local statement_timeout = 600000"))   # clean-up deletes may run longer than a web request is allowed to
        result = k.fn(db, clean_payload(kind_name, payload))
        db.commit()
    except Skip as e:
        db.rollback()
        _finish(db, jid, "done", {"skipped": str(e)[:200]}, None)
        return {"id": jid, "kind": kind_name, "status": "done"}
    except Exception as e:
        db.rollback()
        log.exception("job failed", extra={"job": jid, "kind": kind_name})
        msg = f"{type(e).__name__}: {str(e).splitlines()[0] if str(e) else ''}"[:300]
        again = attempts < most and k is not None
        _finish(db, jid, "queued" if again else "dead", None, msg, now() + _backoff(attempts) if again else None)
        return {"id": jid, "kind": kind_name, "status": "queued" if again else "dead"}
    # The work is saved. Writing "done" is a separate step: if that fails the job is not run a second time; `recover` will close it.
    _finish(db, jid, "done", result, None)
    return {"id": jid, "kind": kind_name, "status": "done"}


def recover(db: Session, minutes: int = 15) -> int:
    """A job still 'running' long after it started belongs to a worker that died. It goes back in the queue, or is given up if it has had its tries."""
    stuck = db.scalars(select(Job).where(Job.status == "running", Job.started_at < now() - timedelta(minutes=minutes)).with_for_update(skip_locked=True)).all()
    for j in stuck:
        again = j.attempts < j.max_attempts
        j.status, j.last_error = ("queued" if again else "dead"), "the worker stopped while this was running"
        if again:
            j.run_at = now()
        else:
            j.finished_at = now()
    db.commit()
    return len(stuck)


# ---------- repeating work ----------
DEFAULTS = [
    # name, label, kind, payload, every_seconds, daily_at
    ("monitor", "Health check", "monitor.check", {}, 300, None),
    ("web-alert-rules", "Field alert rules of the web app", "web.alert_rules", {}, 300, None),
    ("purge-deleted-files", "Remove deleted files for good", "files.purge_deleted", {"older_than_days": 7}, None, time(2, 30)),
    ("prune-events", "Clear old live-update events", "events.prune", {"keep_days": 14}, None, time(2, 40)),
    ("auth-cleanup", "Clear expired logins and codes", "auth.cleanup", {"keep_days": 90, "history_days": 365, "idle_days": 7}, None, time(2, 50)),
    ("prune-notifications", "Clear old notification records", "notify.prune", {"keep_days": 90}, None, time(3, 0)),
    ("prune-jobs", "Clear old job history", "jobs.prune", {"keep_days": 14, "failed_keep_days": 60}, None, time(3, 10)),
]


def next_run(every_seconds: int | None, daily_at: time | None, after: datetime) -> datetime:
    if every_seconds:
        return after + timedelta(seconds=every_seconds)
    local = after.astimezone(NPT)
    at = local.replace(hour=daily_at.hour, minute=daily_at.minute, second=0, microsecond=0)
    if at <= local:
        at += timedelta(days=1)
    return at.astimezone(UTC)


def ensure_schedules(db: Session) -> int:
    """Creates the standard schedules that are missing. Never changes one that exists, so an administrator's settings survive restarts."""
    have = set(db.scalars(select(Schedule.name)))
    made = 0
    for name, label, kind_name, payload, every, daily in DEFAULTS:
        if name not in have:
            enabled = get_settings().web_cron_ready if kind_name == "web.alert_rules" else True
            db.add(Schedule(name=name, label=label, kind=kind_name, payload=clean_payload(kind_name, payload), every_seconds=every, daily_at=daily, enabled=enabled, next_run_at=next_run(every, daily, now())))
            made += 1
    db.commit()
    return made


def schedule_due(db: Session) -> int:
    """Queues a job for every schedule whose time has come. If its last job has not finished, no second one is queued."""
    due = db.scalars(select(Schedule).where(Schedule.enabled, Schedule.next_run_at <= now()).with_for_update(skip_locked=True)).all()
    made = 0
    for s in due:
        try:
            with db.begin_nested():
                jid = enqueue(db, s.kind, s.payload, dedupe_key=f"schedule:{s.name}", schedule=s.name) if s.kind in KINDS else None
        except ApiError:   # its stored numbers are outside today's limits: skip this one, never the whole round
            log.error("schedule has a payload its job no longer accepts", extra={"schedule": s.name})
            jid, s.last_status = None, "dead"
        if jid:
            s.last_job_id = jid
            made += 1
        s.next_run_at = next_run(s.every_seconds, s.daily_at, now())  # from now, not from the missed time: after an outage it runs once, not once per missed turn
    db.commit()
    return made


def counts(db: Session) -> dict:
    by = dict(db.execute(text(f"select status, count(*) from {SCHEMA}.jobs where created_at > now() - interval '7 days' group by 1")).all())  # noqa: S608
    late = db.execute(text(f"select extract(epoch from now() - min(run_at)) from {SCHEMA}.jobs where status = 'queued' and run_at <= now()")).scalar()  # noqa: S608
    return {"last_7_days": by, "oldest_due_seconds": float(late) if late is not None else 0}
