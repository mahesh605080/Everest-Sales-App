# Phase 8 report — admin console and documentation

**Status: complete and tested.**

1. **Features.**
   - **Platform console** in the web app (`/admin`, in the menu under Administration, Super Admin only), built from the app's existing cards, tables and buttons:
     - *Overview*: open alerts with "mark as seen"; one card each for service state, database size and connections, database version, background worker, jobs, push queue, people online, files and disk, requests; which channels are switched on; configuration to fix. Refreshes every 15 seconds.
     - *Logins*: everyone logged in now, on what device, from where; end any one login (it stops working at once). Security history with a filter.
     - *Jobs and schedules*: each schedule with next and last run; run now; switch off and on. Recent jobs with result or error; run a failed job again; cancel a waiting one.
     - *Notifications*: counts for the last 7 days by how far messages got; devices registered for push; switch a device off; link to the send screen.
     - *Storage*: space in total, by type, per person.
     - *Database*: every table with size and read counts; look at the newest 25 records of any table, secrets masked. Read-only; no SQL box.
     - *Live and requests*: connections, listener state, events passed on; slowest and busiest requests.
   - **Who is logged in** across the whole company, and ending one login, as new admin endpoints.
   - **Audit log search** in the existing audit screen: by person, action, record or address.
   - **Documentation** in `docs/platform/`: `README.md` (how the pieces fit, running, tests), `INTEGRATION.md` (developer guide with code: login and refresh, live connection protocol, chat, files, document store, push, sending notifications), `API-REFERENCE.md` (all 82 endpoints, generated from the route table so it cannot drift), `OPERATIONS.md` (settings, console, schedules, every alert with what to do, logs, start and stop). Interactive API pages at `/api/v1/docs` outside production. Every endpoint now has a one-line description.
2. **Existing files modified.** `backend/app/routers/admin_ops.py` and the summaries in `admin_db.py`, `admin_users.py`, `auth.py`, `data.py`, `files.py`, `notify.py`, `realtime.py`; `backend/tests/test_jobs.py`; web `app/(console)/layout.tsx`, `app/(console)/audit/page.tsx`, `scripts/smoke.ts`, `README.md`.
3. **New files.** `components/AdminConsole.tsx`, `app/(console)/admin/page.tsx`, `backend/scripts/api_doc.py`, `backend/scripts/__init__.py`, `docs/platform/README.md`, `INTEGRATION.md`, `API-REFERENCE.md`, `OPERATIONS.md`.
4. **Migrations.** None.
5. **Tests run.**
   - Backend **125 passed** (1 new: all-sessions view and ending a login).
   - Web suite **195 passed** (3 new: console closed to everyone but the Super Admin, a temporary password blocks it, audit search including a hostile search text).
   - In a real Chromium as the Super Admin: all seven tabs opened with live data; a phone login was ended from the console and its token answered 401 straight after; a schedule was run from the console and its job appeared as done; a schedule was switched off and on; the `public.users` table was opened and the password column showed as masked with no hash on the page; audit search returned rows; no sideways scrolling at phone width; no page errors.
   - The statements in the guides were checked against the code (message names, token behaviour, parameters, defaults); two were corrected.
6. **Existing versus new failures.** None.
7. **Security controls verified.** Console page and every admin endpoint refuse anyone below the Super Admin, and a Super Admin still on a temporary password. Ending a login is refused to a GM. The sessions list contains no token. The table view masks secret columns. The audit search text is passed only as a parameter.
8. **Limitations.**
   - The console has no screen to edit settings: channels and secrets are set in the server's environment on purpose.
   - Schedule numbers (how many days to keep) can be changed through the API but not yet from the console.
   - Devices in the notification tab show the person's id, not their name.
   - No charts or history over time: request figures are since the last start.
   - No backup tab yet; backup arrives in Phase 9.
   - The console is in the web app only, not the phone app.
9. **Configuration.** None new.
10. **Commands.** Regenerate the API reference after changing endpoints: `cd backend && DATABASE_URL=postgresql://x/y PLATFORM_ENV=test PLATFORM_WORKER=0 .venv/bin/python -m scripts.api_doc`.
11. **Next.** Phase 9: security hardening, performance tests, backup and restore, deployment.
