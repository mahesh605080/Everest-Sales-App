"""Live connections and what each is subscribed to. One process holds them in memory; events arrive from the database, so any process
(this service or the web app) can cause one simply by committing a row to platform.events."""
import asyncio
import contextlib
import logging
import time
from dataclasses import dataclass, field

import psycopg
from fastapi import WebSocket
from sqlalchemy import text
from starlette.concurrency import run_in_threadpool

from ..config import get_settings
from ..db import SCHEMA, session_factory
from ..deps import Principal
from ..services import events as ev

log = logging.getLogger("platform.realtime")
QUEUE_MAX, IDLE_SECONDS, AUTH_GRACE = 500, 75, 30
SWEEP_SECONDS = 15.0  # how often stale and ended connections are closed (the tests shorten it)


@dataclass(eq=False)
class Conn:
    ws: WebSocket
    principal: Principal
    token_exp: float
    subs: dict[str, int] = field(default_factory=dict)        # channel -> highest event id already sent
    pending: dict[str, list] = field(default_factory=dict)    # channel -> live events held back while its replay is being sent
    queue: asyncio.Queue = field(default_factory=lambda: asyncio.Queue(QUEUE_MAX))
    last_seen: float = field(default_factory=time.monotonic)
    closed: bool = False

    def push(self, msg: dict) -> bool:
        try:
            self.queue.put_nowait(msg)
            return True
        except asyncio.QueueFull:
            return False


class Hub:
    def __init__(self):
        self.conns: set[Conn] = set()
        self.channels: dict[str, set[Conn]] = {}
        self.cursor = 0
        self.tasks: list[asyncio.Task] = []
        self.stats = {"events_dispatched": 0, "messages_sent": 0, "connections_total": 0, "dropped_slow": 0, "listener_restarts": 0}
        self.listening = False

    # ---- lifecycle ----
    async def start(self):
        self.cursor = await run_in_threadpool(self._last_id)
        self.tasks = [asyncio.create_task(self._listen(), name="rt-listen"), asyncio.create_task(self._sweep(), name="rt-sweep")]

    async def stop(self):
        for t in self.tasks:
            t.cancel()
        for t in self.tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        for c in list(self.conns):
            await self.close(c, 1001, "server shutting down")

    def _last_id(self) -> int:
        with session_factory()() as db:
            return ev.last_id(db)

    # ---- connections ----
    def add(self, c: Conn):
        self.conns.add(c)
        self.stats["connections_total"] += 1

    def remove(self, c: Conn):
        c.closed = True
        self.conns.discard(c)
        for ch in list(c.subs):
            self.channels.get(ch, set()).discard(c)
            if not self.channels.get(ch):
                self.channels.pop(ch, None)

    async def close(self, c: Conn, code: int, reason: str):
        if c.closed:
            return
        self.remove(c)
        with contextlib.suppress(Exception):
            await c.ws.close(code=code, reason=reason[:120])

    def online(self, user_ids: list[int]) -> dict[int, bool]:
        live = {c.principal.id for c in self.conns}
        return {u: u in live for u in user_ids}

    # ---- subscriptions ----
    def begin_subscribe(self, c: Conn, channel: str, since: int):
        """Live events for the channel are held back until the replay has been queued, so the client receives everything once and in order."""
        c.subs[channel] = since
        c.pending[channel] = []
        self.channels.setdefault(channel, set()).add(c)

    def finish_subscribe(self, c: Conn, channel: str, replayed: list[dict]):
        held = c.pending.pop(channel, [])
        for m in [*replayed, *held]:
            self._deliver(c, channel, m)

    def unsubscribe(self, c: Conn, channel: str):
        c.subs.pop(channel, None)
        c.pending.pop(channel, None)
        self.channels.get(channel, set()).discard(c)

    def _deliver(self, c: Conn, channel: str, msg: dict):
        if c.closed or channel not in c.subs or msg["id"] <= c.subs[channel]:
            return  # already sent: never the same event twice on one connection
        if not c.push(msg):
            self.stats["dropped_slow"] += 1
            asyncio.create_task(self.close(c, 1013, "too slow to keep up; reconnect and resume from your last event id"))  # noqa: RUF006
            return
        c.subs[channel] = msg["id"]
        self.stats["messages_sent"] += 1

    def dispatch(self, msg: dict):
        self.stats["events_dispatched"] += 1
        for c in list(self.channels.get(msg["channel"], ())):
            if msg["channel"] in c.pending:
                c.pending[msg["channel"]].append(msg)
            else:
                self._deliver(c, msg["channel"], msg)
        for hook in self.on_event:
            hook(msg)

    on_event: list = []  # callables(msg); used for chat delivery receipts

    # ---- the database listener ----
    async def _listen(self):
        dsn = get_settings().database_url.replace("postgresql+psycopg://", "postgresql://")
        while True:
            try:
                async with await psycopg.AsyncConnection.connect(dsn, autocommit=True) as conn:
                    await conn.execute("listen platform_events")
                    self.listening = True
                    while True:
                        await self._drain(conn)  # first: anything committed while we were not listening
                        async for _ in conn.notifies(timeout=5, stop_after=1):
                            pass
            except asyncio.CancelledError:
                raise
            except Exception:
                self.listening = False
                self.stats["listener_restarts"] += 1
                log.exception("event listener lost its database connection; reconnecting")
                await asyncio.sleep(2)

    async def _drain(self, conn):
        while True:
            cur = await conn.execute(f"select id, channel, type, payload, created_at from {SCHEMA}.events where id > %s order by id limit 500", (self.cursor,))  # noqa: S608
            rows = await cur.fetchall()
            for r in rows:
                self.cursor = r[0]
                self.dispatch({"type": "event", "id": r[0], "channel": r[1], "event": r[2], "payload": r[3], "at": r[4].isoformat()})
            if len(rows) < 500:
                return

    # ---- housekeeping ----
    async def _sweep(self):
        while True:
            await asyncio.sleep(SWEEP_SECONDS)
            try:
                now, mono = time.time(), time.monotonic()
                for c in list(self.conns):
                    if mono - c.last_seen > IDLE_SECONDS:
                        await self.close(c, 1001, "no heartbeat")
                    elif now > c.token_exp + AUTH_GRACE:
                        await self.close(c, 4401, "token expired; send a fresh one")
                gone = await run_in_threadpool(self._ended, list(self.conns))
                for c in gone:
                    await self.close(c, 4401, "login ended")
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("sweep failed")

    @staticmethod
    def _ended(conns: list[Conn]) -> list[Conn]:
        """Connections whose login has been ended or whose account has been switched off since they connected."""
        if not conns:
            return []
        with session_factory()() as db:
            sids = [c.principal.session_id for c in conns if c.principal.session_id]
            dead_sids = {str(r[0]) for r in db.execute(text(f"select id from {SCHEMA}.sessions where id = any(cast(:s as uuid[])) and (revoked_at is not null or expires_at <= now())"), {"s": sids})} if sids else set()  # noqa: S608
            alive_users = {r[0] for r in db.execute(text("select u.id from public.users u join public.roles r on r.id = u.role_id where u.id = any(:u) and u.active and r.active"), {"u": [c.principal.id for c in conns]})}
        return [c for c in conns if c.principal.id not in alive_users or (c.principal.session_id and c.principal.session_id in dead_sids)]

    def snapshot(self) -> dict:
        return {"connections": len(self.conns), "people_online": len({c.principal.id for c in self.conns}), "channels": len(self.channels), "listening": self.listening, "cursor": self.cursor, **self.stats}


hub = Hub()
