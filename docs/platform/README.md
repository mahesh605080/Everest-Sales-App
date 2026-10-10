# Everest platform service

The part of the system that would otherwise be rented from Firebase or Supabase, built and run by us: logins and sessions, live updates and chat, file storage, notifications, background jobs, and an admin console. It is a Python service (`backend/`) that sits beside the web app and uses the same PostgreSQL database.

## How the pieces fit

```
 Browser ─┐                          ┌─ web app (Next.js, port 3000)  ── business screens and /api/*
          ├─ https ─ reverse proxy ──┤
 Phone  ──┘        (Caddy)           └─ platform (FastAPI, port 8000) ── /api/v1/*  and  /ws
                                              │
                                   PostgreSQL ┴ one database
                                     schema "public"   : the web app's tables (customers, orders ...)
                                     schema "platform" : sessions, events, files, notifications, jobs ...
```

- **One identity.** Both services sign and accept the same login token (shared `AUTH_SECRET`). A login made in one is valid in the other, and ending it in one ends it in both.
- **One database, two owners.** The web app's numbered SQL migrations own `public`. Alembic owns `platform`. Neither touches the other's tables, except that the platform reads people and roles, and writes into the web app's notification inbox.
- **Nothing outside.** No Firebase, Supabase or other hosted backend. Browser push uses the open Web Push standard; iPhone push goes straight to Apple.

## Documents in this folder

| Document | For | What is in it |
|---|---|---|
| `INTEGRATION.md` | App developers | Logging in, calling the API, live connection, files, push, with code |
| `API-REFERENCE.md` | App developers | Every endpoint (generated from the code) |
| `NOTIFICATIONS.md` | Everyone | What reaches which device and when, honestly; how to switch push on |
| `OPERATIONS.md` | Whoever runs the server | Settings, starting and stopping, jobs, alerts, the console |
| `DEPLOYMENT.md` | Whoever runs the server | Putting it on a server, backup, test restore, restore, upgrade, going back |
| `SECURITY.md` | Everyone | Threats, the control for each and the test that checks it; open points; go-live checklist |
| `PERFORMANCE.md` | Technical readers | Load test results and what they mean |
| `AUDIT.md` | Background | What existed before, and why the service was added beside it instead of replacing it |
| `CHECKLIST.md`, `REPORT-phase-N.md` | Project record | What was built and tested in each phase, and what was not |

## Running it on a developer machine

```
# database: any PostgreSQL 14+
export DATABASE_URL=postgresql://user:pass@localhost:5432/sfa AUTH_SECRET=<32+ random characters>

npm install && npm run migrate && npm run seed -- --sample      # the web app's tables and sample people
cd backend && python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m alembic upgrade head                        # the platform's tables
.venv/bin/uvicorn app.main:app --port 8000                      # platform
cd .. && npm run dev                                            # web app on 3000; it forwards /api/v1 and /ws to 8000
```

Interactive API pages: `http://localhost:8000/api/v1/docs` (switched off in production).

## Tests

```
cd backend && PG_ADMIN_URL=postgresql://postgres@localhost:5432/postgres ./scripts/test.sh     # creates and fills a throw-away database
BASE_URL=http://localhost:3000 npm run smoke                                                   # whole system over HTTP; needs both services running on a test database
```

Never point either at real data: both create and delete records.
