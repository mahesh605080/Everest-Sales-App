# Final report — self-hosted platform, phases 0 to 9

## What exists now

A Python service (`backend/`, FastAPI, SQLAlchemy, Alembic, PostgreSQL) running beside the existing web app, on the same database and the same logins. Nothing of the existing web app, phone app or data was replaced or removed; the business screens and API are unchanged in behaviour.

| Phase | What it added | Report |
|---|---|---|
| 0 | Audit of what existed; decision to add a service beside the web app rather than rebuild | `AUDIT.md` |
| 1 | Service skeleton, configuration, health, migrations in its own schema | `REPORT-phase-1.md` |
| 2 | Logins with short tokens and rotating refresh tokens, sessions, devices, reset codes, login history, level rule | `REPORT-phase-2.md` |
| 3 | Document store with declared fields and rules; read-only database view | `REPORT-phase-3.md` |
| 4 | Live updates over WebSocket with ordered, replayable events; chat with receipts; presence | `REPORT-phase-4.md` |
| 5 | Private file storage with content-based type checks, allowances, sharing, signed links | `REPORT-phase-5.md` |
| 6 | Notification engine and queue, Web Push, iPhone push sender, preferences, phone notifications | `REPORT-phase-6.md` |
| 7 | Background jobs, schedules, health rules with self-closing alerts | `REPORT-phase-7.md` |
| 8 | Admin console in the web app; developer, API and operations documents | `REPORT-phase-8.md` |
| 9 | Hardening, threat model, load test, backup with test restore, deployment guide, independent review | `REPORT-phase-9.md` |

## Numbers at the end

| | |
|---|---|
| Platform service tests | 152, all passing |
| Web end-to-end checks | 198, all passing (157 before the platform work began) |
| Phone app unit tests | 24, all passing (11 before) |
| API endpoints in the platform service | 82, plus the live connection |
| Platform database migrations | 7, each checked against the models; web migrations 022 to 026 added, all additive |
| Known vulnerabilities, Python and web dependencies | 0 |

## The requirements, one by one

| Requirement | State |
|---|---|
| Existing apps, routes, logic, records and features preserved | Kept. The web suite that existed before still passes in full, inside a larger one |
| No restart from scratch; no framework replaced | Kept. One library was upgraded two major versions in Phase 9 (the map library, to remove a flaw rated critical); the map screen was re-tested |
| No destructive changes | Kept. Every migration adds. Restore keeps the old database |
| No Firebase, Supabase or other hosted backend | Kept. Two things to know, both explained in `NOTIFICATIONS.md`: browser push necessarily passes through the browser maker's push service using the open standard (no Firebase SDK or account); and the Android notification library is compiled with Google's messaging client, which is never started |
| No extra app for users to install for notifications | Kept |
| Own backend in Python with open-source parts | Done |
| No fake success, mock presented as real, or hidden placeholders | Delivery states say exactly how far a message got; channels without credentials report themselves off; every limitation is written down |
| No secrets in frontend code, logs, the repository or API answers | Tested (`SECURITY.md`) |
| Incremental, each phase tested and reported | Ten reports and a checklist |

## What is not proven, in one place

1. **Docker**: images never built or started. Likely to need small fixes on the first real start.
2. **Real devices**: the phone app has never been installed on a phone. No push has travelled through a real push service or Apple.
3. **Android when the app is closed**: notifications arrive at the next background check (about 15 minutes at best), or within a couple of minutes while "On duty" is on. Instant delivery would need Google's messaging service.
4. **Scale beyond one process**: live connections are held by a single service process; tested to 300 connections on a small machine.
5. **Security open points**: no two-step login, backups not encrypted, no virus scan of uploads, no penetration test by people.
6. **The mobile repository**: pushes to `Everest-Sales-app-Mobile` are refused for this session. The phone app's code, up to date, is on branch `mobile-app-backup` of the web repository.

## What to do next, in order

1. Install the Claude GitHub App on the mobile repository (or push the `mobile-app-backup` branch there yourself).
2. Put the system on a server following `DEPLOYMENT.md`; note what the first Docker start needed.
3. Go through the go-live checklist at the end of `SECURITY.md`.
4. Schedule the nightly backup and do one restore drill on a spare machine.
5. Build the Android app and try it on two or three phones for a week, with "On duty" on.
6. Decide on two-step login for the Super Admin and Credit Control.
