"""Operations for the Super Admin: background jobs, schedules, alerts, and one page of how the service is doing.
A job can only be one of the kinds built into the code, with whole numbers inside set limits. There is no way to run a command or SQL from here."""
import shutil
import time as clock
from pathlib import Path

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .. import metrics, worker
from ..config import get_settings
from ..db import get_db
from ..deps import Principal, super_admin
from ..errors import ApiError
from ..models.jobs import Alert, Job, Schedule
from ..realtime.hub import hub
from ..services import files as files_svc
from ..services import jobs as svc
from ..services import monitor
from ..services import notify as notify_svc
from .health import migration_status

router = APIRouter(prefix="/admin", tags=["admin: operations"])


def job_view(j: Job) -> dict:
    return {"id": j.id, "kind": j.kind, "label": svc.KINDS[j.kind].label if j.kind in svc.KINDS else j.kind, "payload": j.payload, "status": j.status, "attempts": j.attempts, "max_attempts": j.max_attempts,
            "run_at": j.run_at, "started_at": j.started_at, "finished_at": j.finished_at, "seconds": round((j.finished_at - j.started_at).total_seconds(), 2) if j.finished_at and j.started_at else None,
            "last_error": j.last_error, "result": j.result, "schedule": j.schedule, "created_by": j.created_by, "created_at": j.created_at}


@router.get("/jobs/kinds", summary="The kinds of job that exist, and the numbers each accepts")
def kinds(_: Principal = Depends(super_admin)):
    return {"kinds": [{"kind": n, "label": k.label, "max_attempts": k.max_attempts, "params": {p: {"default": d, "min": lo, "max": hi} for p, (d, lo, hi) in k.params.items()}} for n, k in sorted(svc.KINDS.items())]}


@router.get("/jobs")
def jobs(_: Principal = Depends(super_admin), db: Session = Depends(get_db), status: str | None = Query(None, pattern="^(queued|running|done|dead|cancelled)$"), kind: str | None = Query(None, max_length=60),
         limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0)):
    q = select(Job).order_by(Job.id.desc()).limit(limit).offset(offset)
    if status:
        q = q.where(Job.status == status)
    if kind:
        q = q.where(Job.kind == kind)
    return {"jobs": [job_view(j) for j in db.scalars(q)], "counts": svc.counts(db)}


class JobIn(BaseModel):
    kind: str = Field(max_length=60)
    payload: dict = Field(default_factory=dict)


@router.post("/jobs", status_code=201, summary="Run one of the built-in jobs now")
def run_now(body: JobIn, p: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    jid = svc.enqueue(db, body.kind, body.payload, dedupe_key=f"manual:{body.kind}", created_by=p.id, priority=3)
    if jid is None:
        raise ApiError(409, "This job is already waiting or running.", "conflict")
    return job_view(db.get(Job, jid))


def _job(db: Session, job_id: int) -> Job:
    j = db.get(Job, job_id, with_for_update=True)
    if j is None:
        raise ApiError(404, "This job does not exist.", "not_found")
    return j


@router.get("/jobs/{job_id}")
def job(job_id: int, _: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    return job_view(_job(db, job_id))


@router.post("/jobs/{job_id}/retry", summary="Queue a job that failed for good, with its tries reset")
def retry(job_id: int, _: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    j = _job(db, job_id)
    if j.status not in ("dead", "cancelled"):
        raise ApiError(409, "Only a job that failed or was cancelled can be run again.", "conflict")
    if j.dedupe_key and db.scalar(select(Job.id).where(Job.dedupe_key == j.dedupe_key, Job.status.in_(["queued", "running"]))):
        raise ApiError(409, "The same job is already waiting or running.", "conflict")
    j.status, j.attempts, j.run_at, j.last_error, j.finished_at, j.started_at = "queued", 0, svc.now(), None, None, None
    return job_view(j)


@router.post("/jobs/{job_id}/cancel", summary="Stop a job that has not started. One that is running finishes.")
def cancel(job_id: int, _: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    j = _job(db, job_id)
    if j.status != "queued":
        raise ApiError(409, "Only a waiting job can be cancelled.", "conflict")
    j.status, j.finished_at = "cancelled", svc.now()
    return job_view(j)


def schedule_view(s: Schedule) -> dict:
    return {"name": s.name, "label": s.label, "kind": s.kind, "payload": s.payload, "every_seconds": s.every_seconds, "daily_at": s.daily_at.strftime("%H:%M") if s.daily_at else None, "time_zone": "Asia/Kathmandu",
            "enabled": s.enabled, "next_run_at": s.next_run_at, "last_run_at": s.last_run_at, "last_status": s.last_status, "last_job_id": s.last_job_id}


@router.get("/schedules")
def schedules(_: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    return {"schedules": [schedule_view(s) for s in db.scalars(select(Schedule).order_by(Schedule.name))]}


class ScheduleIn(BaseModel):
    enabled: bool | None = None
    every_seconds: int | None = Field(None, ge=60, le=7 * 86400)
    daily_at: str | None = Field(None, max_length=5)
    payload: dict | None = None


def _schedule(db: Session, name: str) -> Schedule:
    s = db.get(Schedule, name, with_for_update=True)
    if s is None:
        raise ApiError(404, "This schedule does not exist.", "not_found")
    return s


@router.patch("/schedules/{name}", summary="Switch a schedule on or off, or change how often it runs. The kind of work cannot be changed.")
def set_schedule(name: str, body: ScheduleIn, _: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    s = _schedule(db, name)
    if body.every_seconds is not None and body.daily_at is not None:
        raise ApiError(422, "Give either an interval or a time of day, not both.", "invalid_request")
    if body.every_seconds is not None:
        s.every_seconds, s.daily_at = body.every_seconds, None
    if body.daily_at is not None:
        s.daily_at, s.every_seconds = notify_svc.parse_time(body.daily_at), None
        if s.daily_at is None:
            raise ApiError(422, "Give the time as HH:MM.", "invalid_request")
    if body.payload is not None:
        s.payload = svc.clean_payload(s.kind, body.payload)
    if body.enabled is not None:
        s.enabled = body.enabled
    s.next_run_at, s.updated_at = svc.next_run(s.every_seconds, s.daily_at, svc.now()), svc.now()
    return schedule_view(s)


@router.post("/schedules/{name}/run", status_code=201, summary="Run a schedule's job now, without waiting for its time")
def run_schedule(name: str, p: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    s = _schedule(db, name)
    jid = svc.enqueue(db, s.kind, s.payload, dedupe_key=f"schedule:{s.name}", schedule=s.name, created_by=p.id, priority=3)
    if jid is None:
        raise ApiError(409, "Its job is already waiting or running.", "conflict")
    s.last_job_id = jid
    return job_view(db.get(Job, jid))


def alert_view(a: Alert) -> dict:
    return {"id": a.id, "rule": a.rule, "severity": a.severity, "message": a.message, "detail": a.detail, "count": a.count, "first_seen_at": a.first_seen_at, "last_seen_at": a.last_seen_at, "resolved_at": a.resolved_at,
            "acknowledged_by": a.acknowledged_by, "acknowledged_at": a.acknowledged_at}


@router.get("/alerts")
def alerts(_: Principal = Depends(super_admin), db: Session = Depends(get_db), open_only: bool = True, limit: int = Query(100, ge=1, le=500)):
    q = select(Alert).order_by(Alert.resolved_at.is_not(None), Alert.last_seen_at.desc()).limit(limit)
    if open_only:
        q = q.where(Alert.resolved_at.is_(None))
    return {"alerts": [alert_view(a) for a in db.scalars(q)], "rules": sorted(monitor.RULES)}


@router.post("/alerts/{alert_id}/acknowledge", summary="Mark an alert as seen. It still closes only when the problem is gone.")
def acknowledge(alert_id: int, p: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    a = db.get(Alert, alert_id)
    if a is None:
        raise ApiError(404, "This alert does not exist.", "not_found")
    a.acknowledged_by, a.acknowledged_at = p.id, svc.now()
    return alert_view(a)


@router.get("/monitor", summary="One page of how the service is doing")
def overview(_: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    s = get_settings()
    d = Path(s.files_dir)
    while not d.exists() and d != d.parent:
        d = d.parent
    disk = shutil.disk_usage(d)
    conns = db.execute(text("select count(*) filter (where state = 'active') as active, count(*) as total, current_setting('max_connections')::int as max from pg_stat_activity")).mappings().first()
    f = files_svc.usage(db)["total"]
    return {
        "time": clock.time(), "environment": s.env,
        "database": {"ok": True, "bytes": db.execute(text("select pg_database_size(current_database())")).scalar(), "connections": dict(conns), "migrations": migration_status(db)},
        "worker": worker.status(), "jobs": svc.counts(db), "notifications": notify_svc.queue_stats(db), "realtime": hub.snapshot(),
        "storage": {"files": f["files"], "bytes": int(f["bytes"]), "waiting_purge_bytes": int(f["waiting_purge"]), "disk_free_bytes": disk.free, "disk_total_bytes": disk.total},
        "api": metrics.snapshot(15),
        "alerts": [alert_view(a) for a in db.scalars(select(Alert).where(Alert.resolved_at.is_(None)).order_by(Alert.severity, Alert.last_seen_at.desc()))],
        "configuration": {"problems": s.problems(), "channels": {"webpush": s.webpush_ready, "apns": s.apns_ready, "email": bool(s.smtp_host), "web_alert_rules": s.web_cron_ready}},
    }
