"""The background worker. It runs inside the service process and does what must happen without anyone asking.
Two loops, so a long job never holds up notifications: one sends notifications every couple of seconds, one runs scheduled and queued jobs."""
import asyncio
import contextlib
import logging
import time

from starlette.concurrency import run_in_threadpool

from .db import session_factory
from .services import jobs, notify

log = logging.getLogger("platform.worker")
state: dict = {"running": False, "notify": {"passes": 0, "last_at": None, "last_error": None}, "jobs": {"passes": 0, "last_at": None, "last_error": None, "ran": 0}}
JOBS_PER_PASS = 5


def tick() -> dict:
    """One notification pass. Safe to run from several processes at once: rows are claimed with row locks."""
    out: dict = {}
    with session_factory()() as db:
        try:
            out["released"] = notify.release_scheduled(db)
            out["ingested"] = notify.ingest_system(db)
            db.commit()
            out.update(notify.process_due(db))
            if state["notify"]["passes"] % 30 == 0:
                out["recovered"] = notify.recover_stuck(db)
                db.commit()
        except Exception:
            db.rollback()
            raise
    return out


def job_tick() -> dict:
    """One job pass: queue what the schedules call for, then run a few due jobs, one after another."""
    out: dict = {"ran": []}
    with session_factory()() as db:
        try:
            if state["jobs"]["passes"] % 60 == 0:
                out["recovered"] = jobs.recover(db)
            out["scheduled"] = jobs.schedule_due(db)
            for _ in range(JOBS_PER_PASS):
                r = jobs.run_one(db)
                if r is None:
                    break
                out["ran"].append(r)
        except Exception:
            db.rollback()
            raise
    return out


_stop: asyncio.Event | None = None
_tasks: list[asyncio.Task] = []


async def _loop(name: str, fn, interval: float):
    assert _stop is not None
    s = state[name]
    while not _stop.is_set():
        try:
            out = await run_in_threadpool(fn)
            s["last_error"] = None
            if name == "jobs":
                s["ran"] += len(out.get("ran", []))
        except Exception as e:
            s["last_error"] = type(e).__name__
            log.exception("worker pass failed", extra={"loop": name})
        s["passes"] += 1
        s["last_at"] = time.time()
        with contextlib.suppress(TimeoutError):
            await asyncio.wait_for(_stop.wait(), interval)


def start():
    global _stop, _tasks
    _stop = asyncio.Event()
    with session_factory()() as db:
        jobs.ensure_schedules(db)
    state["running"] = True
    _tasks = [asyncio.create_task(_loop("notify", tick, 2.0), name="worker-notify"), asyncio.create_task(_loop("jobs", job_tick, 5.0), name="worker-jobs")]


async def stop(grace: float = 30.0):
    """Asks both loops to stop and waits for the pass in hand, so nothing is left half-done on shutdown."""
    global _tasks
    if not _tasks or _stop is None:
        return
    _stop.set()
    done, pending = await asyncio.wait(_tasks, timeout=grace)
    for t in pending:   # a job that outlasts the grace period is picked up again by `recover` after the restart
        t.cancel()
    _tasks, state["running"] = [], False


def status() -> dict:
    now = time.time()
    age = lambda v: round(now - v, 1) if v else None  # noqa: E731
    return {"running": state["running"], "notify": {**state["notify"], "seconds_since_last": age(state["notify"]["last_at"])}, "jobs": {**state["jobs"], "seconds_since_last": age(state["jobs"]["last_at"])}}
