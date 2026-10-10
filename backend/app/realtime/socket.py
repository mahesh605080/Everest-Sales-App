"""The WebSocket endpoint. Messages are small JSON objects with a "type".

client -> server   auth {token} · subscribe {channel, since?} · unsubscribe {channel} · ping · chat.send {room, text, client_id} · chat.read {room, upto} · presence {users:[ids]}
server -> client   ready · subscribed {channel, last_id} · event {id, channel, event, payload, at} · pong · presence {online:{id:bool}} · error {code, message, ref?}
"""
import asyncio
import contextlib
import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from ..db import session_factory
from ..deps import COOKIE, load_principal
from ..errors import ApiError
from ..security import read_token
from ..services import chat
from ..services import events as ev
from .hub import Conn, hub

router = APIRouter()
MAX_MESSAGE, MAX_SUBS, AUTH_TIMEOUT = 8192, 50, 10


def _identify(token: str):
    """Returns (principal, token expiry) or None. Runs in a worker thread."""
    with session_factory()() as db:
        p = load_principal(db, token)
        claims = read_token(token) if p else None
        return (p, float(claims["exp"])) if p and claims and not p.must_change_password else None


def _origin_ok(ws: WebSocket) -> bool:
    origin = ws.headers.get("origin")
    if not origin:
        return True
    host = ws.headers.get("x-forwarded-host") or ws.headers.get("host") or ""
    return origin.rstrip("/") in {f"http://{host}", f"https://{host}", *get_settings().origins}


def _with_db(fn, *args):
    def run():
        with session_factory()() as db:
            try:
                out = fn(db, *args)
                db.commit()
                return out
            except Exception:
                db.rollback()
                raise
    return run_in_threadpool(run)


@router.websocket("/ws")
async def socket(ws: WebSocket):
    await ws.accept()
    conn: Conn | None = None
    sender: asyncio.Task | None = None

    async def fail(code: str, message: str, ref=None):
        msg = {"type": "error", "code": code, "message": message, **({"ref": ref} if ref is not None else {})}
        if conn is not None:
            conn.push(msg)  # one writer per socket: everything goes through the connection's queue
        else:
            await ws.send_json(msg)

    try:
        # A browser on our own pages is recognised by its cookie; everything else sends {"type":"auth","token":...} first.
        ident = None
        cookie = ws.cookies.get(COOKIE)
        if cookie and _origin_ok(ws):
            ident = await run_in_threadpool(_identify, cookie)
        if ident is None:
            try:
                first = json.loads(await asyncio.wait_for(ws.receive_text(), AUTH_TIMEOUT))
            except (TimeoutError, ValueError):
                return await ws.close(code=4401, reason="authenticate first")
            ident = await run_in_threadpool(_identify, str(first.get("token", ""))) if first.get("type") == "auth" else None
        if ident is None:
            return await ws.close(code=4401, reason="not authenticated")
        p, exp = ident
        conn = Conn(ws=ws, principal=p, token_exp=exp)
        hub.add(conn)

        async def pump():
            while True:
                await ws.send_json(await conn.queue.get())
        conn.push({"type": "ready", "user_id": p.id, "heartbeat_seconds": 25, "channels": [f"user:{p.id}", "all"], "last_event_id": hub.cursor})
        for ch in (f"user:{p.id}", "all"):  # everyone hears their own channel and company-wide announcements
            hub.begin_subscribe(conn, ch, 0)
            hub.finish_subscribe(conn, ch, [])
        sender = asyncio.create_task(pump())

        while True:
            raw = await ws.receive_text()
            conn.last_seen = time.monotonic()
            if len(raw) > MAX_MESSAGE:
                await fail("too_large", "Message too large.")
                continue
            try:
                m = json.loads(raw)
                kind = m["type"]
            except (ValueError, KeyError, TypeError):
                await fail("bad_message", "Send a JSON object with a type.")
                continue
            ref = m.get("ref")
            if kind == "ping":
                conn.push({"type": "pong"})
            elif kind == "auth":  # a fresh token before the old one runs out keeps the connection open
                again = await run_in_threadpool(_identify, str(m.get("token", "")))
                if again is None or again[0].id != p.id:
                    return await hub.close(conn, 4401, "not authenticated")
                conn.principal, conn.token_exp = again
                conn.push({"type": "authenticated", "ref": ref})
            elif kind == "subscribe":
                ch, since = str(m.get("channel", "")), m.get("since")
                if ch not in conn.subs and len(conn.subs) >= MAX_SUBS:
                    await fail("too_many", "Too many subscriptions on one connection.", ref)
                    continue
                if not await _with_db(ev.may_subscribe, conn.principal, ch):
                    await fail("forbidden", "You may not listen to this channel.", ref)
                    continue
                resume = isinstance(since, int) and since >= 0
                hub.begin_subscribe(conn, ch, since if resume else 0)
                replayed = await _with_db(ev.replay, ch, since) if resume else []
                conn.push({"type": "subscribed", "channel": ch, "replayed": len(replayed), "ref": ref})
                hub.finish_subscribe(conn, ch, replayed)
            elif kind == "unsubscribe":
                hub.unsubscribe(conn, str(m.get("channel", "")))
                conn.push({"type": "unsubscribed", "channel": m.get("channel"), "ref": ref})
            elif kind == "presence":
                ids = [int(x) for x in (m.get("users") or [])[:200] if isinstance(x, int)]
                conn.push({"type": "presence", "online": {str(k): v for k, v in hub.online(ids).items()}, "ref": ref})
            elif kind in ("chat.send", "chat.read"):
                try:
                    if kind == "chat.send":
                        out = await _with_db(chat.send, conn.principal, str(m.get("room", "")), m.get("text"), m.get("client_id"))
                        conn.push({"type": "chat.sent", "message": out, "ref": ref})
                    else:
                        await _with_db(chat.mark_read, conn.principal, str(m.get("room", "")), m.get("upto"))
                        conn.push({"type": "chat.read.ok", "ref": ref})
                except ApiError as e:
                    await fail(e.code, e.message, ref)
            else:
                await fail("unknown_type", f"Unknown message type '{kind}'.", ref)
    except WebSocketDisconnect:
        pass
    finally:
        if sender:
            sender.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await sender
        if conn:
            hub.remove(conn)
