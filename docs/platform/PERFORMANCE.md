# Performance test

Run with `backend/scripts/loadtest.py` against the service on a database loaded with bulk data: 319 people, 500,000 live-update events, 200,000 login records, 200,000 delivery records, 100,000 inbox rows.

**Read the numbers as a floor.** The test machine had 2 CPU cores and 7 GB of memory, and those two cores also ran PostgreSQL and the load generator itself. One service process, default settings (5 database connections, 5 spare). No reverse proxy in front.

## Results

| What | Load | Per second | Typical | 95 in 100 under | Slowest | Errors |
|---|---|---|---|---|---|---|
| Any authenticated call, one at a time | 1 | 241 | 4 ms | 6 ms | 15 ms | 0 |
| Any authenticated call | 50 at once | 208 | 165 ms | 682 ms | 2.0 s | 0 |
| Login (password check) | 8 at once, 200 people | 8.8 | 0.9 s | 1.1 s | 1.2 s | 0 |
| Catch-up read: a full page of 500 missed events | 30 at once | 52 | 544 ms | 1.1 s | 1.9 s | 0 |
| Security history page from 200,000 records | 10 at once | 117 | 83 ms | 122 ms | 155 ms | 0 |
| Chat message sent | 40 at once | 79 | 490 ms | 809 ms | 1.3 s | 0 |
| Conversation list with unread counts | 30 at once | 208 | 92 ms | 420 ms | 0.9 s | 0 |
| File upload, 200 KB | 10 at once | 95 | 104 ms | 148 ms | 191 ms | 0 |
| File download, 200 KB | 20 at once | 135 | 150 ms | 219 ms | 392 ms | 0 |
| Notification to everyone (319 people) | one after another | 2.1 | 478 ms | 578 ms | 578 ms | 0 |
| Live connection opened | 300, 50 at a time | 331 | 110 ms | 157 ms | 166 ms | 0 |
| One event reaching 300 open connections | 20 events | | 19 ms | 29 ms | 38 ms | 0 missed |
| Push queue, push service answering in 150 ms | 600 messages | 44 | | | | 0 |

The test was run again on the final code after the last fixes of Phase 9; every figure was within about 15% of the table above, with no errors.

Queries that must stay fast as tables grow, on the bulk data:

| Query | Time | How the database found the rows |
|---|---|---|
| Events after an id on one channel (500,000 events) | 0.2 ms | index only |
| Due deliveries for the worker (200,000 deliveries) | 0.07 ms | index |
| Newest security history (200,000 records) | 0.06 ms | index only |
| One person's inbox (100,000 rows) | 0.11 ms | index |
| A login by its id | 0.03 ms | primary key |

## What the numbers mean for this company

- **A single request costs about 4 ms.** Under 50 simultaneous requests the two shared cores are the limit, at about 200 requests a second. A field force of a few hundred people produces a few requests a second at the busiest moment.
- **Login is slow on purpose.** Each password check is deliberately expensive, so a stolen password file is useless. About 9 logins a second here: 300 people all logging in during the same minute is fine; all in the same second would queue for half a minute.
- **A live event reaches 300 open apps within 40 ms.**
- **A chat message takes longer under heavy load** (half a second with 40 people sending at the same instant) because events are numbered strictly in the order they are saved, one at a time. That is what guarantees nothing is missed after a reconnect. 79 messages a second is far beyond a company chat.
- **A notification to everyone costs about 1.5 ms per person** inside the request. Comfortable to a few thousand people; beyond that the fan-out should move to the background worker (not built).
- **Push sending is limited by the push services, not by us.** With 8 messages on the wire at once and a typical 150 ms answer, about 44 a second: an announcement to 300 devices is out in about 7 seconds. Before this phase they went one after another, about 6 a second; that was found by this test and changed.
- **Tables can grow.** The lookups that run constantly use indexes and stay well under a millisecond at half a million rows. Old events, job history and notification records are pruned nightly.

## What was not tested

- More than one service process, and more than 300 live connections.
- Sustained load over hours (memory growth, connection leaks). The longest run was a few minutes.
- A real network between client, proxy and service; real push services.
- The web app's own business screens under load (the dashboard and report queries). Those were checked for correctness, not speed.
- Large files near the 10 MB limit under concurrency.

## Run it again

```
createdb sfa_perf && DATABASE_URL=postgresql://…/sfa_perf npm run migrate && npm run seed -- --sample
cd backend && DATABASE_URL=…/sfa_perf .venv/bin/python -m alembic upgrade head
DATABASE_URL=…/sfa_perf .venv/bin/python -m scripts.loadtest --seed
DATABASE_URL=…/sfa_perf AUTH_SECRET=… RATE_LIMIT_PER_MINUTE=0 PLATFORM_WORKER=0 .venv/bin/uvicorn app.main:app --port 8020 &
DATABASE_URL=…/sfa_perf AUTH_SECRET=… .venv/bin/python -m scripts.loadtest --url http://localhost:8020
```

The script refuses any database whose name does not contain `perf`.
