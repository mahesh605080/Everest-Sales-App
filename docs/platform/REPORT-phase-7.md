# Phase 7 report — background jobs, scheduler, monitoring

**Status: complete and tested.**

1. **Features.**
   - **Jobs.** A job names a *kind*; every kind is a function built into the code with the whole numbers it accepts and their limits. Nothing else can be run: no command, no SQL, no script. States: queued, running, done, dead, cancelled. A failed attempt goes back to the queue with a pause (1, 2, 4 ... minutes, an hour at most) and is given up after its last try. The work of a failed attempt is undone; the record of the failure is kept.
   - **No double work.** A job with the same key cannot wait or run twice (a partial unique index in the database, not a check in code). Two workers never take the same job (row locks). A job left "running" by a worker that died returns to the queue after 15 minutes.
   - **Kinds built in:** remove the contents of deleted files (`files.purge_deleted`), clear old live-update events (`events.prune`), clear expired logins, used reset codes and old login history (`auth.cleanup`), clear old notification records (`notify.prune`), clear old job history and closed alerts (`jobs.prune`), health check (`monitor.check`), and nudge the web app's own field alert rules (`web.alert_rules`).
   - **Schedules.** Every N seconds or daily at a Nepal-time clock time. Seven standard schedules are created at first start and never overwritten afterwards, so an administrator's changes survive restarts. After an outage a schedule runs once, not once per missed turn. A schedule does not queue a second job while its first has not finished.
   - **The web app's alert rules now run by themselves.** They used to need an outside scheduler calling `/api/cron/alerts`. With `CRON_SECRET` set, the platform does it every five minutes. The address comes only from configuration and the key travels in a header.
   - **Monitoring.** Ten rules: push backlog, push failures, failed jobs, late jobs (worker not running), disk nearly full, burst of failed logins, database connections nearly used up, migrations not applied, live-update listener down, weak secret in production. A rule that fires opens one alert; the Super Admin is told once, and once more if it turns critical; the alert closes by itself when the cause is gone. A rule that crashes is reported as an alert and does not stop the others.
   - **Request figures** per route pattern (count, client errors, server errors, average and slowest time), kept in memory with a fixed ceiling.
   - **One overview** for the Super Admin: database, migrations, worker, job and notification queues, live connections, storage and disk, request figures, open alerts, configuration problems and which channels are on.
   - **Worker** now has two loops so a long job cannot delay notifications, and stops cleanly: it finishes the pass in hand before the process exits.
2. **Existing files modified.** `backend/app/config.py`, `app/main.py`, `app/middleware.py`, `app/models/__init__.py`, `app/worker.py`; `docker-compose.yml`, `.env.example`.
3. **New files.** `backend/app/models/jobs.py`, `app/services/jobs.py`, `app/services/monitor.py`, `app/routers/admin_ops.py`, `app/metrics.py`, `migrations/versions/0007_jobs_schedules_alerts.py`, `tests/test_jobs.py`.
4. **Migrations.** Platform `0007` (jobs, schedules, alerts), additive; checked with `alembic check`.
5. **Tests run.** Backend **124 passed** (20 new). With the whole stack running: the scheduler called the real web app's alert endpoint and got `{"ok": true}`; the health check ran with 10 rules and no alert; both worker loops reported passes with no error. Web suite unchanged at 192 (no web code changed in this phase).
6. **Existing versus new failures.** None.
7. **Security controls verified by test.** Only the Super Admin reaches jobs, schedules, alerts and the overview. Unknown kinds (`shell.exec`, `sql.run`) and unknown or out-of-range parameters, strings, booleans and fractions are refused. A schedule's kind cannot be changed, only its timing and its numbers. The cron key never appears in a job record, an error message or the overview. The overview contains no secret and no database address. Request figures are grouped by pattern and cannot grow without limit.
8. **Limitations.**
   - A running job cannot be interrupted; cancel works only before it starts. Jobs here are short, set-based deletes.
   - Request figures and worker state are per process and are lost on restart. There is no long-term metrics store and no external alerting (email, SMS); alerts reach the Super Admin through the app's own notifications.
   - Schedules are interval or daily; there is no full cron syntax.
   - The worker runs inside the service process. Running several processes is safe for jobs and notifications, but the live connection remains single-process.
   - Database backup is not a job yet (Phase 9).
9. **Configuration.** `WEB_INTERNAL_URL` (Docker: `http://app:3000`, already in the compose file), `CRON_SECRET` (16+ characters, the same value for the web app and the platform), `PLATFORM_WORKER` (set `0` to run the API without the worker).
10. **Commands.** None new. Jobs and schedules are managed from the admin API (and the admin console in Phase 8).
11. **Next.** Phase 8: admin console and documentation.
