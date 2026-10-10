"""The background worker. It runs inside the service process and does what must happen without anyone asking:
releasing scheduled notifications, picking up the web app's notifications, sending push and putting stuck work back."""
import asyncio
import contextlib
import logging
import time

from starlette.concurrency import run_in_threadpool

from .db import session_factory
from .services import notify

log = logging.getLogger("platform.worker")
state = {"running": False, "ticks": 0, "last_tick_at": None, "last_error": None}


def tick() -> dict:
    """One pass. Safe to run from several processes at once: rows are claimed with row locks."""
    out: dict = {}
    with session_factory()() as db:
        try:
            out["released"] = notify.release_scheduled(db)
            out["ingested"] = notify.ingest_system(db)
            db.commit()
            out.update(notify.process_due(db))
            if state["ticks"] % 30 == 0:
                out["recovered"] = notify.recover_stuck(db)
                db.commit()
        except Exception:
            db.rollback()
            raise
    return out


async def run(interval: float = 2.0):
    state["running"] = True
    try:
        while True:
            try:
                await run_in_threadpool(tick)
                state["last_error"] = None
            except Exception as e:
                state["last_error"] = type(e).__name__
                log.exception("worker pass failed")
            state["ticks"] += 1
            state["last_tick_at"] = time.time()
            await asyncio.sleep(interval)
    finally:
        state["running"] = False


_task: asyncio.Task | None = None


def start():
    global _task
    _task = asyncio.create_task(run(), name="worker")


async def stop():
    """Lets the pass in hand finish, so nothing is left half-sent on shutdown."""
    if _task:
        _task.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await _task
