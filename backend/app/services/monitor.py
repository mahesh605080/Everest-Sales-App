"""Health rules. Each looks at one thing and says nothing, or says what is wrong. The results become alerts that open and close by themselves."""
import logging
import shutil
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SCHEMA
from ..models.jobs import Alert

log = logging.getLogger("platform.monitor")
Finding = tuple[str, str, dict]  # severity, message, detail
LIMITS = {"notify_backlog_warn": 600, "notify_backlog_crit": 3600, "notify_dead_hour": 20, "jobs_late": 1800, "disk_warn": 0.10, "disk_crit": 0.03, "failed_logins_15m": 50, "db_conn_share": 0.8, "backup_hours": 36, "verify_days": 8}


def _notify_backlog(db: Session) -> Finding | None:
    s = db.execute(text(f"select extract(epoch from now() - min(next_attempt_at)) from {SCHEMA}.deliveries where status in ('queued','failed') and next_attempt_at <= now() and channel <> 'inapp'")).scalar()  # noqa: S608
    s = float(s or 0)
    if s > LIMITS["notify_backlog_warn"]:
        return ("critical" if s > LIMITS["notify_backlog_crit"] else "warning", f"Push notifications have been waiting {int(s // 60)} minutes to be sent.", {"seconds": int(s)})
    return None


def _notify_dead(db: Session) -> Finding | None:
    n = db.execute(text(f"select count(*) from {SCHEMA}.deliveries where status = 'dead' and updated_at > now() - interval '1 hour'")).scalar() or 0  # noqa: S608
    return ("warning", f"{n} push notifications could not be sent in the last hour.", {"count": n}) if n >= LIMITS["notify_dead_hour"] else None


def _jobs_dead(db: Session) -> Finding | None:
    rows = db.execute(text(f"select kind, count(*) from {SCHEMA}.jobs where status = 'dead' and finished_at > now() - interval '24 hours' group by 1 order by 1")).all()  # noqa: S608
    return ("warning", "Background jobs failed in the last day: " + ", ".join(f"{k} ({n})" for k, n in rows) + ".", {"kinds": {k: n for k, n in rows}}) if rows else None


def _jobs_late(db: Session) -> Finding | None:
    s = float(db.execute(text(f"select extract(epoch from now() - min(run_at)) from {SCHEMA}.jobs where status = 'queued' and run_at <= now()")).scalar() or 0)  # noqa: S608
    return ("warning", f"Background jobs have been waiting {int(s // 60)} minutes. The worker may not be running.", {"seconds": int(s)}) if s > LIMITS["jobs_late"] else None


def _disk(db: Session) -> Finding | None:
    p = Path(get_settings().files_dir)
    while not p.exists() and p != p.parent:
        p = p.parent
    u = shutil.disk_usage(p)
    free = u.free / u.total if u.total else 1
    if free < LIMITS["disk_warn"]:
        return ("critical" if free < LIMITS["disk_crit"] else "warning", f"The disk that holds uploaded files is {round((1 - free) * 100)}% full.", {"free_bytes": u.free, "total_bytes": u.total})
    return None


def _failed_logins(db: Session) -> Finding | None:
    n = db.execute(text(f"select count(*) from {SCHEMA}.login_events where at > now() - interval '15 minutes' and outcome in ('wrong_password', 'unknown_user', 'locked_out', 'rate_limited', 'inactive', 'refresh_reuse')")).scalar() or 0  # noqa: S608
    return ("warning", f"{n} failed logins in the last 15 minutes. Someone may be guessing passwords.", {"count": n}) if n >= LIMITS["failed_logins_15m"] else None


def _db_connections(db: Session) -> Finding | None:
    used, most = db.execute(text("select (select count(*) from pg_stat_activity), current_setting('max_connections')::int")).one()
    return ("warning", f"The database is using {used} of its {most} connections.", {"used": used, "max": most}) if used / most > LIMITS["db_conn_share"] else None


def _migrations(db: Session) -> Finding | None:
    from ..routers.health import migration_status
    m = migration_status(db)["platform"]
    return None if m["up_to_date"] else ("critical", "The platform database is not at the version this code expects. Run the migrations.", m)


def _realtime(db: Session) -> Finding | None:
    from ..realtime.hub import hub
    if not any(not t.done() for t in hub.tasks):  # not running in this process (a one-off command, a test): nothing to say
        return None
    return None if hub.listening else ("critical", "Live updates are not listening to the database. They will catch up when the connection returns.", {})


def _configuration(db: Session) -> Finding | None:
    s = get_settings()
    if s.env != "production":
        return None
    p = [x for x in s.problems() if "AUTH_SECRET" in x]
    return ("critical", p[0] + ".", {}) if p else None


def backup_state(db: Session) -> dict:
    """What the backup scripts last recorded. They write two small settings; nothing about the backup's contents is kept here."""
    import json
    out: dict = {"last": None, "verified": None}
    for key, name in (("backup.last", "last"), ("backup.verified", "verified")):
        v = db.execute(text(f"select value from {SCHEMA}.settings where key = :k"), {"k": key}).scalar()  # noqa: S608
        try:
            out[name] = json.loads(v) if v else None
        except ValueError:
            out[name] = None
    return out


def _age_hours(stamp: str | None) -> float | None:
    try:
        return (datetime.now(UTC) - datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))).total_seconds() / 3600
    except (TypeError, ValueError):
        return None


def _backup(db: Session) -> Finding | None:
    if get_settings().env != "production":   # a developer machine has no backups and needs none
        return None
    b = backup_state(db)
    age = _age_hours((b["last"] or {}).get("at"))
    if age is None:
        return ("warning", "No backup has been made yet. Set up the nightly backup (see the deployment guide).", {})
    if age > LIMITS["backup_hours"]:
        return ("critical" if age > 3 * LIMITS["backup_hours"] else "warning", f"The last backup is {int(age // 24)} days {int(age % 24)} hours old.", {"hours": int(age)})
    v = b["verified"] or {}
    if v.get("ok") is False:
        return ("critical", "The last test restore of a backup failed: " + str(v.get("reason", "see the server"))[:160], {"name": v.get("name")})
    vage = _age_hours(v.get("at"))
    if vage is None or vage > LIMITS["verify_days"] * 24:
        return ("warning", "No backup has been test-restored " + ("yet." if vage is None else f"for {int(vage // 24)} days.") + " A backup that was never restored is only a hope.", {})
    return None


RULES = {"backup": _backup, "notify.backlog": _notify_backlog, "notify.failures": _notify_dead, "jobs.failed": _jobs_dead, "jobs.late": _jobs_late, "storage.disk": _disk, "auth.failed_logins": _failed_logins,
         "db.connections": _db_connections, "db.migrations": _migrations, "realtime.listener": _realtime, "configuration": _configuration}


def run(db: Session) -> dict:
    opened, closed, firing = [], [], 0
    now = datetime.now(UTC)
    for rule, check in RULES.items():
        try:
            with db.begin_nested():
                found = check(db)
        except Exception:
            log.exception("health rule crashed", extra={"rule": rule})
            found = ("warning", "This health check could not run. See the server log.", {})
        a = db.scalar(select(Alert).where(Alert.rule == rule, Alert.resolved_at.is_(None)))
        if found:
            firing += 1
            sev, msg, detail = found
            if a is None:
                a = Alert(rule=rule, severity=sev, message=msg, detail=detail, count=1)
                db.add(a)
                db.flush()
                opened.append(rule)
                _tell_admins(db, a, worse=False)
            else:
                worse = sev == "critical" and a.severity != "critical"
                a.severity, a.message, a.detail, a.count, a.last_seen_at = sev, msg, detail, a.count + 1, now
                if worse:
                    _tell_admins(db, a, worse=True)
        elif a is not None:
            a.resolved_at = now
            closed.append(rule)
    return {"checked": len(RULES), "firing": firing, "opened": opened, "closed": closed}


def _tell_admins(db: Session, a: Alert, worse: bool) -> None:
    """The Super Admin hears about a new problem once, and once more if it becomes critical. Not every five minutes."""
    from . import notify
    notify.create(db, title=("Critical: " if a.severity == "critical" else "Warning: ") + a.rule.replace(".", " "), body=a.message, audience={"kind": "role", "key": "admin"}, category="general", url="/admin",
                  priority=1 if a.severity == "critical" else 5, source="manual", idempotency_key=f"alert:{a.id}:{'critical' if worse else 'open'}")
