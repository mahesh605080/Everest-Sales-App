"""When a chat message is handed to a live connection of its recipient, record that it was delivered and tell the sender."""
import asyncio
import logging

from starlette.concurrency import run_in_threadpool

from ..db import session_factory
from ..services import chat
from .hub import hub

log = logging.getLogger("platform.realtime")


def _store(user_id: int, room: str, message_id: int):
    with session_factory()() as db:
        try:
            chat.mark_delivered(db, user_id, room, message_id)
            db.commit()
        except Exception:
            db.rollback()
            log.exception("could not record a delivery receipt")


def _on_event(msg: dict):
    if msg["event"] != "chat.message":
        return
    user_id = int(msg["channel"].split(":")[1])
    if msg["payload"].get("sender_id") == user_id or not any(c.principal.id == user_id for c in hub.channels.get(msg["channel"], ())):
        return
    asyncio.create_task(run_in_threadpool(_store, user_id, msg["payload"]["room"], msg["payload"]["id"]))  # noqa: RUF006


def install():
    if _on_event not in hub.on_event:
        hub.on_event.append(_on_event)
