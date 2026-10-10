"""Load test for the platform service. Fills a database with bulk data, then drives a running service and prints what it measured.

  1. make a database whose name contains "perf", with the web app's tables and sample people, and `alembic upgrade head`
  2. DATABASE_URL=... python -m scripts.loadtest --seed                       (bulk data)
  3. start the service on it with RATE_LIMIT_PER_MINUTE=0 PLATFORM_WORKER=0
  4. DATABASE_URL=... AUTH_SECRET=... python -m scripts.loadtest --url http://localhost:8020

It refuses to run on a database whose name does not contain "perf": it writes hundreds of thousands of rows.
The numbers describe this machine with the load generator on the same CPUs; they are a floor, not a promise.
"""
import argparse
import asyncio
import json
import os
import statistics
import time

import httpx
import psycopg
import websockets

PW = "Everest@123"
N_USERS = 300
RESULTS: list[dict] = []


def pct(xs: list[float], p: float) -> float:
    xs = sorted(xs)
    return xs[min(len(xs) - 1, int(len(xs) * p))] if xs else 0.0


def report(name: str, lat: list[float], seconds: float, errors: int = 0, note: str = ""):
    row = {"scenario": name, "requests": len(lat), "per_second": round(len(lat) / seconds, 1) if seconds else 0, "p50_ms": round(pct(lat, 0.5) * 1000, 1), "p95_ms": round(pct(lat, 0.95) * 1000, 1),
           "p99_ms": round(pct(lat, 0.99) * 1000, 1), "max_ms": round(max(lat) * 1000, 1) if lat else 0, "errors": errors, "note": note}
    RESULTS.append(row)
    print(json.dumps(row), flush=True)


async def drive(name: str, workers: int, seconds: float, call, note: str = ""):
    """`workers` loops calling `call(i, n)` until the time is up. A call returns True/False for success."""
    lat: list[float] = []
    errors = 0
    stop = time.perf_counter() + seconds

    async def loop(i: int):
        nonlocal errors
        n = 0
        while time.perf_counter() < stop:
            t = time.perf_counter()
            try:
                ok = await call(i, n)
            except Exception:
                ok = False
            if ok:
                lat.append(time.perf_counter() - t)
            else:
                errors += 1
            n += 1
    t0 = time.perf_counter()
    await asyncio.gather(*(loop(i) for i in range(workers)))
    report(name, lat, time.perf_counter() - t0, errors, note or f"{workers} at once")


def seed(dsn: str):
    with psycopg.connect(dsn, autocommit=True) as c:
        name = c.execute("select current_database()").fetchone()[0]
        if "perf" not in name:
            raise SystemExit(f"refusing to load-test database '{name}': its name must contain 'perf'")
        if c.execute("select count(*) from public.users where code like 'LT%'").fetchone()[0] >= N_USERS:
            print("bulk data already present", flush=True)
            return
        t = time.perf_counter()
        c.execute("update public.users set must_change_password = false, failed_logins = 0, locked_until = null")
        c.execute("""insert into public.users(code, name, password_hash, role_id, region_id, area_id, active, must_change_password)
                     select 'LT' || lpad(g::text, 4, '0'), 'Load Tester ' || g, u.password_hash, u.role_id, u.region_id, u.area_id, true, false
                       from generate_series(1, %s) g, (select * from public.users where code = 'SO01') u""", (N_USERS,))
        c.execute("alter table platform.events disable trigger user")   # bulk history, not live events: nobody should be told about these
        c.execute("insert into platform.events(channel, type, payload, created_at) select 'user:' || (g % 300 + 1), 'notification', '{\"title\":\"x\"}', now() - (g || ' seconds')::interval from generate_series(1, 500000) g")
        c.execute("alter table platform.events enable trigger user")
        c.execute("insert into platform.login_events(user_id, login, outcome, ip, at) select g % 300 + 1, 'LT', case when g % 9 = 0 then 'wrong_password' else 'success' end, '10.0.0.1', now() - (g || ' seconds')::interval from generate_series(1, 200000) g")
        c.execute("insert into platform.notifications(id, title, category, audience, priority, status, source, created_at) select gen_random_uuid(), 'bulk ' || g, 'general', '{}', 5, 'done', 'system', now() - (g || ' minutes')::interval from generate_series(1, 2000) g")
        c.execute("""insert into platform.deliveries(notification_id, user_id, channel, status, attempts, next_attempt_at, created_at)
                     select n.id, g, 'inapp', 'stored', 0, now(), now() - interval '2 days' from platform.notifications n, generate_series(1, 100) g where n.title like 'bulk %'""")
        c.execute("insert into public.notifications(user_id, title, body, link, origin) select g % 300 + 1, 'bulk', 'b', '/orders', 'engine' from generate_series(1, 100000) g")
        c.execute("analyze")
        print(f"bulk data loaded in {time.perf_counter() - t:.1f} s: {N_USERS} people, 500,000 events, 200,000 login records, 200,000 deliveries, 100,000 inbox rows", flush=True)


async def main(url: str, dsn: str):
    seed(dsn)
    limits = httpx.Limits(max_connections=200, max_keepalive_connections=200)
    async with httpx.AsyncClient(base_url=url, timeout=30, limits=limits) as c:
        codes = [f"LT{i:04d}" for i in range(1, 201)]
        tokens: dict[str, str] = {}
        ids: dict[str, int] = {}

        # 1. logins: each one is a deliberate half-second of password hashing work
        lat, t0 = [], time.perf_counter()

        async def login_worker(w):
            for code in codes[w::8]:
                t = time.perf_counter()
                r = await c.post("/api/v1/auth/login", json={"login": code, "password": PW}, headers={"x-forwarded-for": f"10.1.{w}.{len(lat) % 250}"})
                if r.status_code == 200:
                    d = r.json()
                    tokens[code], ids[code] = d["access_token"], d["user"]["id"]
                    lat.append(time.perf_counter() - t)
        await asyncio.gather(*(login_worker(w) for w in range(8)))
        report("login (password check with Argon2id)", lat, time.perf_counter() - t0, len(codes) - len(lat), "8 at once, 200 different people")
        admin = (await c.post("/api/v1/auth/login", json={"login": "ADMIN", "password": PW})).json()["access_token"]
        H = [{"authorization": f"Bearer {tokens[k]}"} for k in codes if k in tokens]
        AH = {"authorization": f"Bearer {admin}"}
        assert len(H) >= 150, f"only {len(H)} logins worked"

        # 2. the cheapest authenticated call: token check plus the person's role
        async def me(i, n):
            return (await c.get("/api/v1/auth/me", headers=H[(i * 7 + n) % len(H)])).status_code == 200
        await drive("who am I, one request at a time (the cost of a single call)", 1, 4, me)
        await drive("who am I (token check, every request pays this)", 50, 8, me)

        # 3. reads against big tables
        async def inbox_events(i, n):
            uid = ids[codes[(i + n) % len(H)]]
            return (await c.get(f"/api/v1/realtime/events?channel=user:{uid}&since=0", headers=H[(i + n) % len(H)])).status_code == 200
        await drive("catch-up read from 500,000 events", 30, 6, inbox_events)

        async def history(i, n):
            return (await c.get("/api/v1/admin/login-events?limit=100", headers=AH)).status_code == 200
        await drive("security history page from 200,000 records", 10, 5, history)

        # 4. chat: a write, receipts and two live events per message
        rooms = []
        for k in range(0, len(H) - 1, 2):
            r = await c.post("/api/v1/chat/rooms", json={"user_ids": [ids[codes[k + 1]]]}, headers=H[k])
            rooms.append((k, r.json()["id"]))

        async def chat(i, n):
            k, room = rooms[(i + n * 13) % len(rooms)]
            r = await c.post(f"/api/v1/chat/rooms/{room}/messages", json={"text": f"load {i}-{n}", "client_id": f"{i}-{n}-{time.time_ns()}"}, headers=H[k])
            return r.status_code == 201
        await drive("chat message sent", 40, 6, chat, "40 at once across 100 conversations")

        async def room_list(i, n):
            return (await c.get("/api/v1/chat/rooms", headers=H[(i + n) % len(H)])).status_code == 200
        await drive("conversation list with unread counts", 30, 5, room_list)

        # 5. files
        blob = (b"Everest load test line\n" * 9000)[:200_000]
        file_ids: list[tuple[int, str]] = []

        async def upload(i, n):
            k = (i * 11 + n) % len(H)
            r = await c.post("/api/v1/files", files={"file": (f"load-{i}-{n}.txt", blob)}, headers=H[k])
            if r.status_code == 201:
                file_ids.append((k, r.json()["id"]))
            return r.status_code == 201
        await drive("file upload, 200 KB", 10, 6, upload)

        async def download(i, n):
            k, fid = file_ids[(i + n) % len(file_ids)]
            r = await c.get(f"/api/v1/files/{fid}/download", headers=H[k])
            return r.status_code == 200 and len(r.content) == len(blob)
        await drive("file download, 200 KB", 20, 6, download)

        # 6. one notification to everyone: an inbox row, a live event and a delivery record per person, in one transaction
        lat = []
        people = 0
        for n in range(5):
            t = time.perf_counter()
            r = await c.post("/api/v1/notifications", json={"title": f"Load announcement {n}", "body": "to everyone", "audience": {"kind": "all"}, "priority": 1}, headers=AH)
            lat.append(time.perf_counter() - t)
            people = r.json()["deliveries"].get("inapp:stored", 0)
        report("notification to everyone", lat, sum(lat), 0, f"{people} people each time, one after another")

        # 7. live connections
        ws_url = url.replace("http", "ws", 1) + "/ws"
        socks, lat = [], []

        async def open_one(k):
            t = time.perf_counter()
            s = await websockets.connect(ws_url, max_queue=None)
            await s.send(json.dumps({"type": "auth", "token": tokens[codes[k % len(H)]]}))
            ready = json.loads(await s.recv())
            assert ready["type"] == "ready", ready
            lat.append(time.perf_counter() - t)
            socks.append(s)
        t0 = time.perf_counter()
        for batch in range(0, 300, 50):
            await asyncio.gather(*(open_one(k) for k in range(batch, batch + 50)))
        report("live connection opened and authenticated", lat, time.perf_counter() - t0, 300 - len(socks), "300 connections, 50 at a time")

        async def wait_for(s, marker):
            while True:
                m = json.loads(await asyncio.wait_for(s.recv(), 15))
                if m.get("type") == "event" and m.get("payload", {}).get("marker") == marker:
                    return time.perf_counter()
        spread, missed = [], 0
        for n in range(20):
            marker = f"m{n}-{time.time_ns()}"
            waits = [asyncio.create_task(wait_for(s, marker)) for s in socks]
            await asyncio.sleep(0)
            t = time.perf_counter()
            r = await c.post("/api/v1/realtime/publish", json={"channel": "all", "event": "notice", "payload": {"title": "load", "marker": marker}}, headers=AH)
            assert r.status_code == 200, r.text
            done = await asyncio.gather(*waits, return_exceptions=True)
            got = [d - t for d in done if isinstance(d, float)]
            missed += len(done) - len(got)
            spread += got
            await asyncio.sleep(0.1)
        report("one event reaching 300 open connections", spread, 1, missed, "time from the request that causes it to arrival; 20 events, every arrival counted")
        RESULTS[-1]["per_second"] = None
        await asyncio.gather(*(s.close() for s in socks))

    # 8. the push queue, with the network step replaced by an instant "accepted": what the queue itself can do
    from app.db import session_factory
    from app.services import notify, push_senders
    from app.services.push_senders import Result
    def slow_push(sub, payload, ttl, urgent):
        time.sleep(0.15)    # a push service that takes 150 ms to answer, which is ordinary
        return Result(ok=True, status=201)
    push_senders.SENDERS["webpush"] = slow_push
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.execute("delete from platform.push_subscriptions where endpoint like 'https://fcm.googleapis.com/load/%'")
        conn.execute("insert into platform.push_subscriptions(user_id, channel, endpoint, p256dh, auth, failures, active) select g % 300 + 1, 'webpush', 'https://fcm.googleapis.com/load/' || g, 'x', 'y', 0, true from generate_series(1, 600) g")
        conn.execute("""insert into platform.deliveries(notification_id, user_id, channel, subscription_id, status, attempts, next_attempt_at)
                        select (select id from platform.notifications where title like 'bulk %' limit 1), s.user_id, 'webpush', s.id, 'queued', 0, now() from platform.push_subscriptions s where s.endpoint like 'https://fcm.googleapis.com/load/%'""")
        conn.execute("update platform.notifications set expires_at = now() + interval '1 day' where title like 'bulk %'")
    with session_factory()() as db:
        t, n = time.perf_counter(), 0
        while True:
            out = notify.process_due(db, 500)
            if not out["accepted"]:
                break
            n += out["accepted"]
        took = time.perf_counter() - t
    report("push queue: deliveries sent, with a push service that takes 150 ms per message", [took / n] * n if n else [], took, 600 - n, "one worker process, 8 on the wire at a time")

    # 9. the queries that must stay fast as tables grow
    with psycopg.connect(dsn, autocommit=True) as conn:
        plans = {
            "events after an id on one channel": "select id from platform.events where channel = 'user:7' and id > 400000 order by id limit 500",
            "due deliveries for the worker": "select id from platform.deliveries where status in ('queued','failed') and next_attempt_at <= now() and channel <> 'inapp' order by next_attempt_at limit 50 for update skip locked",
            "newest security history": "select id from platform.login_events order by id desc limit 100",
            "one person's inbox": "select id, title from public.notifications where user_id = 7 order by at desc limit 30",
            "a login by its id": "select 1 from platform.sessions where id = (select id from platform.sessions limit 1) and revoked_at is null and expires_at > now()",
        }
        for name, q in plans.items():
            rows = [r[0] for r in conn.execute("explain (analyze, buffers off, timing on) " + q).fetchall()]
            ms = float(next(r for r in rows if r.startswith("Execution Time")).split(":")[1].replace("ms", ""))
            scan = next((r.strip().split(" on ")[0].replace("->", "").strip() for r in rows if "Scan" in r), "?")
            RESULTS.append({"scenario": "query: " + name, "p50_ms": round(ms, 2), "note": scan})
            print(json.dumps(RESULTS[-1]), flush=True)

    print("\nSUMMARY " + json.dumps({"median_me_ms": next(r["p50_ms"] for r in RESULTS if r["scenario"].startswith("who am I")), "scenarios": len(RESULTS),
                                    "errors": sum(r.get("errors", 0) for r in RESULTS), "mean_p95_ms": round(statistics.mean(r["p95_ms"] for r in RESULTS if "p95_ms" in r), 1)}))
    out = os.environ.get("LOADTEST_OUT")
    if out:
        with open(out, "w") as f:
            json.dump(RESULTS, f, indent=1)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:8020")
    ap.add_argument("--seed", action="store_true", help="only load the bulk data, then stop (do this before starting the service)")
    a = ap.parse_args()
    dsn = os.environ["DATABASE_URL"]
    if a.seed:
        seed(dsn)
    else:
        asyncio.run(main(a.url.rstrip("/"), dsn))
