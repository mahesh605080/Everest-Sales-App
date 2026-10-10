# Phase 9 report — security hardening, performance, backup and restore, deployment

**Status: built and tested on the direct (non-Docker) setup. The Docker images were not built; see item 8.**

1. **Features.**
   - **Hardening.**
     - A ceiling of 1,200 requests a minute per address (an IPv6 /64 counts as one address), answered with 429 and `Retry-After`.
     - Per-person limits: 60 chat messages a minute, 30 notification sends per 10 minutes, 120 uploads per 10 minutes, 60 device registrations an hour; 600 report-backs a minute per address.
     - The body size limit now applies to every address before any login check; only the upload address accepts a file's worth.
     - A browser login unused for 7 days is ended (checked on each request by the web app, and nightly by a job). Phone logins are unaffected.
     - Cookie requests the browser itself marks as cross-site are refused even without an Origin header.
     - Input the database cannot store (a zero byte, a number out of range) is answered as wrong input in both services instead of a server error.
     - Security headers at the proxy (`Strict-Transport-Security`, no `Server`); `.dockerignore` files so no local file or secret is copied into an image.
   - **Threat model and go-live checklist** in `SECURITY.md`: who might attack, each threat, its control and the test that checks it, the open points, and a twelve-line checklist.
   - **Dependencies.** Python: no known vulnerabilities. Web: 5 findings brought to 0 (map library 4.7 → 6.13, which fixed a flaw rated critical; fixed versions of two indirect packages pinned). Phone app: 41 findings from five packages, four of them build tools with no fixed release, one runtime helper whose fix cannot be loaded by the router; left and documented.
   - **Performance.** A repeatable load test (`backend/scripts/loadtest.py`) on bulk data: 500,000 events, 200,000 login records, 200,000 deliveries, 100,000 inbox rows, 319 people, 300 live connections. Results and their meaning in `PERFORMANCE.md`. It found that pushes were sent one after another (about 6 a second with a typical push service); they now go 8 at a time (about 45 a second).
   - **Backup** (`scripts/backup.sh`): the database from one consistent moment plus the uploaded files, a list of exact record counts per table taken from that same moment, version marks and checksums; written under a temporary name and renamed only when complete; keeps the newest 14.
   - **Test restore** (`scripts/verify-backup.sh`): restores a backup into a throw-away database, compares every table's count, checks versions and that every stored file known to the database is in the archive, then removes the throw-away database. Records the result.
   - **Restore** (`scripts/restore.sh`): never destroys. Into an occupied database it restores beside it, checks, and swaps by renaming; the old database is kept until you remove it.
   - **Backup health** in the console (last backup, last test restore) and as an alert in production (no backup in 36 hours, no test restore in 8 days, or a failed one).
   - **Deployment guide** (`DEPLOYMENT.md`): first start, push keys, backup schedule, restore to a new server and over existing data, upgrade, going back (including undoing platform database changes), running without Docker, and where the first Docker start is likely to need attention. A `backup` service in the compose file.
   - **Independent review.** A separate reviewer that had not seen the work read the Phase 6 to 9 code, scripts and documents. It reported 19 findings; all were fixed and each fix has a test or a drill:

     | # | Finding | Fix |
     |---|---|---|
     | 1 | A scheduled notification with an unusable audience made the worker fail every 2 seconds and stopped all push | Audience validated before saving; a notification that still cannot be sent is cancelled, alone |
     | 2 | Anyone, without logging in, could make the server read an unlimited body on addresses under `/files` | Limit applied everywhere; exception only for the exact upload address |
     | 3 | Chat text could be read from the notification history by anyone allowed to send notifications | Chat pushes listed without text; system history only for managers; senders see only their own |
     | 4 | A link like `/\evil.example` passed the "in-site only" check | Strict path rule on the server; the service worker and the bell resolve the link the way a browser does |
     | 5 | A crash mid-batch re-sent up to 50 pushes, and the documents said otherwise | Each result saved as it arrives; iPhone collapse id; documents corrected to "at least once" |
     | 6 | A muted or rate-limited notification was missing from the inbox too, and the limit never released | The inbox always gets everything; held-back rows no longer count against the person |
     | 7 | Pushes queued for one person could reach the next person on a shared browser | Withdrawn when the browser changes hands; the sender refuses a mismatch |
     | 8 | Restore dropped the database before knowing the backup would load | Restore beside, check, then swap; the old database is kept |
     | 9 | "Shown on device" could be overwritten by a late "accepted" | The row is re-read; a status only moves forward |
     | 10 | Most documented settings never reached the containers | Listed in the compose file |
     | 11 | An inbox row saved slightly late could be skipped for push | Each row carries its own "handed over" mark (web migration 026) |
     | 12 | Browsers did not re-subscribe after the server's push key changed | Checked on every visit; the push service's refusal retires the old subscription |
     | 13 | A long notification in Nepali exceeded the push size limit | Sent as UTF-8, not escaped |
     | 14 | Backup scripts: `BACKUP_KEEP=0` deleted everything; paths with spaces failed; other edge cases | Fixed and drilled, including a folder with a space in its name |
     | 15 | One schedule with out-of-range numbers, or a vanished job record, stopped the job round | Handled one by one; outcome written with a plain update |
     | 16 | The readiness check was exempt from the flood limit; IPv6 addresses could be rotated | Only the bare "alive" check is exempt; /64 grouping |
     | 17 | Any sender could mark a message urgent or name 5,000 people | Both need the broadcast permission (above 200 names) |
     | 18 | A developer's local `.env` could be copied into the platform image | Excluded |
     | 19 | A fractional `SESSION_IDLE_DAYS` locked everyone out | Whole days only |
2. **Existing files modified.** Backend `app/config.py`, `main.py`, `middleware.py`, `deps.py`, `errors.py`, `services/notify.py`, `push_senders.py`, `chat.py`, `files.py`, `jobs.py`, `monitor.py`, `routers/notify.py`, `admin_ops.py`, `scripts/test.sh`, tests. Web `lib/auth.ts`, `lib/push.ts`, `public/sw.js`, `components/Shell.tsx`, `MapView.tsx`, `AdminConsole.tsx`, `NotifySend.tsx`, `NotifySettings.tsx`, `app/(console)/audit/page.tsx`, `scripts/smoke.ts`, `package.json`, `package-lock.json`, `docker-compose.yml`, `Caddyfile`, `.env.example`, `.gitignore`, `backend/.dockerignore`, `README.md`, documents.
3. **New files.** `scripts/backup.sh`, `verify-backup.sh`, `restore.sh`, `backup-lib.sh`; `.dockerignore`; `backend/scripts/loadtest.py`; `backend/tests/test_security.py`; `db/migrations/026_notifications_pushed.sql`; `docs/platform/SECURITY.md`, `PERFORMANCE.md`, `DEPLOYMENT.md`.
4. **Migrations.** Web `026` (column `notifications.pushed_at` and a partial index), additive. No platform migration. The path back from platform version 0007 to 0006 and forward again was run.
5. **Tests run.**
   - Backend **152 passed** (27 new in this phase: 15 attack tests, 11 for review findings, 1 for backup health).
   - Web suite **198 passed** (6 new), on the rebuilt app with the upgraded map library.
   - Mobile **24 passed**; type check clean.
   - Map screen in a real Chromium on the new map library: canvas, 13 markers, popup, no page errors.
   - Service worker in a real Chromium, again after the link fix: notification shown, delivery confirmed, outside link reduced to an in-site one.
   - Idle browser login by hand: 20 idle minutes still works and refreshes the mark; 8 idle days answers 401 in both services, reason recorded as `idle`.
   - **Backup drills, all run:** backup and test restore; a backup made while 400 records were being inserted (counts still match exactly); damaged dump detected; counts list that does not match detected; uploaded file missing from the archive detected; folder name with a space; `BACKUP_KEEP=1` keeps one, `0` refused; an address that cannot be re-pointed refused.
   - **Restore drills, all run:** into an empty database; refused without the safety word and with the wrong one; over existing data with later work present (restored database has the backup's content, the kept database still has the later work); a bad backup leaves the target untouched and no half-restored database behind; a connection open during the swap. After an earlier restore the service was started on the restored database: login worked, and the stored PDF downloaded byte for byte.
   - Clean shutdown: the service with its worker exits within about two seconds of SIGTERM.
   - Load test: run twice, no errors.
   - `docker compose config` accepts the compose file, including the backup service.
6. **Existing versus new failures.** None open. Two faults in existing behaviour were found by the new tests and fixed: a zero byte in a search gave a server error (both services), and the review's findings above.
7. **Security controls verified.** See `SECURITY.md`; every row names its test. In summary: forged, unsigned, expired and borrowed tokens; cross-site requests with a cookie, including the live connection; ten injection strings against eleven inputs; floods per address and per person; oversized bodies before login; no secrets in logs, errors or the console; push to the right person only; chat text not exposed through history.
8. **Limitations.**
   - **Docker images were not built.** The Docker daemon ran, but the build machine is not allowed to download base images. The compose file and Dockerfiles were reviewed and corrected (a missing ignore file would have copied local modules and the Python environment into the web image), and the compose file passes its own check. First start on a real server needs watching.
   - **The backup scripts were run with the standard Linux tools, not inside the small `postgres:16-alpine` image** they will run in under Docker. The reviewer checked each command against that image's tool set; it was not executed there.
   - **Backups are not encrypted** by the script.
   - **Performance was measured on 2 shared CPU cores** with the load generator on the same machine, one process, for minutes, not hours.
   - **The phone app's 41 dependency findings remain** (build tools and one URL helper).
   - No two-step login, no virus scanning, no web application firewall, no penetration test by people.
   - A request body sent without a declared length and over the limit is cut off correctly but answered 400 instead of 413.
9. **Configuration.** New: `RATE_LIMIT_PER_MINUTE` (1200), `NOTIFY_PARALLEL` (8), `SESSION_IDLE_DAYS` (7), `BACKUP_KEEP` (14), and for restore `RESTORE_REPLACE`. All in `.env.example` and passed through by the compose file.
10. **Commands.**
    ```
    docker compose run --rm backup
    docker compose run --rm backup sh /scripts/verify-backup.sh
    RESTORE_REPLACE=sfa docker compose run --rm backup sh /scripts/restore.sh <backup-name>
    pip-audit -r backend/requirements.txt ; npm audit --omit=dev
    ```
11. **Next.** All nine phases are done. What remains needs things this environment does not have: a server and domain (first Docker start), a phone (install the app, try notifications), an Apple Developer account (iPhone push), and a decision on the open points in `SECURITY.md`, two-step login first.
