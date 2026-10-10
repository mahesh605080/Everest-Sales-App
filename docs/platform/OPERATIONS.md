# Operations guide

For whoever runs the server. Deployment, backup and restore are in `DEPLOYMENT.md`.

## Settings

All settings are environment variables (the `.env` file next to `docker-compose.yml`). `.env.example` lists every one with a comment. The ones that matter most:

| Setting | Needed | What it does |
|---|---|---|
| `DATABASE_URL` | yes | The PostgreSQL database both services use |
| `AUTH_SECRET` | yes | Signs logins. 32+ random characters, the same for both services. Changing it logs everyone out. The platform refuses to start in production with a weak one |
| `PLATFORM_ENV` | yes | `production` on the server. Switches the interactive API pages off |
| `PUBLIC_URL` | for email links | The address people open |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM` | optional | Password-reset emails. Without them an administrator issues reset codes |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | optional | Browser push. Make them with `python -m app.cli vapid` |
| `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_SANDBOX` | optional | iPhone push |
| `CRON_SECRET` | recommended | Lets the scheduler run the web app's field alert rules. 16+ random characters, the same for both services |
| `WEB_INTERNAL_URL` | with the above | Where the platform reaches the web app. `http://app:3000` in Docker (already set in the compose file) |
| `FILES_DIR` | yes | Where uploaded files are kept. A volume in Docker. **Back it up** |
| `FILE_MAX_BYTES`, `FILE_QUOTA_BYTES` | optional | Largest file (10 MB) and allowance per person (200 MB) |
| `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS` | optional | 15 minutes and 30 days |
| `CORS_ORIGINS` | optional | Only if a browser app on another domain must call the API |
| `PLATFORM_WORKER` | optional | `0` runs the API without the background worker |
| `RATE_LIMIT_PER_MINUTE` | optional | Requests one address may make in a minute before it is told to wait (1200). `0` switches it off |
| `NOTIFY_PARALLEL` | optional | How many push messages are sent at the same moment (8) |
| `SESSION_IDLE_DAYS` | optional | A browser login unused this long is ended (7). Read by the web app; the nightly clean-up uses the same default |
| `BACKUP_KEEP` | optional | How many backups the backup script keeps (14) |

Secrets are never shown by any screen or API. The console lists *that* something is missing, never a value.

## The console

Log in as the Super Admin and open **Platform console** (bottom of the menu, under Administration).

| Tab | What to look at |
|---|---|
| Overview | "Needs attention" at the top is the list of open alerts. Then one card per part of the system, including the last backup and whether it was test-restored. Below: which channels are on, and configuration to fix |
| Logins | Who is logged in now and on what; end any one login. Security history: every login, refusal, lockout and reset |
| Jobs and schedules | The repeating work, when each next runs and how the last run ended. Run one now, or switch it off. Recent jobs with their results; run a failed one again |
| Notifications | Counts by how far messages got in the last 7 days; devices registered for push; switch a device off |
| Storage | Space used in total, by type and per person |
| Database | Every table with its size and how it is read; look at the newest records of any table (secrets masked). Read-only |
| Live and requests | People online, and the slowest and busiest requests since the service started |

## Background work

The worker starts with the service; there is nothing separate to run. It does two things in a loop: sends notifications (every 2 seconds), and runs scheduled and queued jobs (every 5 seconds).

| Schedule | When | What it does |
|---|---|---|
| Health check | every 5 minutes | Checks the rules below and opens or closes alerts |
| Field alert rules of the web app | every 5 minutes | Late check-ins, visits outside the fence and the like (needs `CRON_SECRET`) |
| Remove deleted files for good | 02:30 | Erases the contents of files deleted more than 7 days ago |
| Clear old live-update events | 02:40 | Keeps 14 days |
| Clear expired logins and codes | 02:50 | Ends browser logins unused for 7 days; removes finished logins older than 90 days and login history older than a year |
| Clear old notification records | 03:00 | Keeps 90 days. The inbox itself is not touched |
| Clear old job history | 03:10 | Keeps 14 days of finished jobs, 60 of failed ones |

Times are Nepal time. Numbers can be changed per schedule through the API (`PATCH /api/v1/admin/schedules/{name}` with `payload`); the kind of work cannot.

A job that fails is tried again after 1, 2, 4 ... minutes and given up after its last try. It then shows as **failed** in the console with the error, and can be run again from there.

## Alerts

| Rule | Fires when | What to do |
|---|---|---|
| `backup` | In production: no backup for 36 hours, no test restore for 8 days, or a test restore failed | Run the backup by hand and read its output; see `DEPLOYMENT.md` |
| `notify.backlog` | Push has waited over 10 minutes (critical over an hour) | Is the worker running (Overview)? Can the server reach the internet? |
| `notify.failures` | 20 or more pushes failed for good in an hour | Open a failed notification's details for the reason. Often expired keys or a blocked outbound connection |
| `jobs.failed` | Any job failed for good in the last day | Jobs tab → Failed → read the error → fix → Run again |
| `jobs.late` | A job has waited over 30 minutes | The worker is not running. Restart the platform service |
| `storage.disk` | Under 10% free on the files disk (critical under 3%) | Free space or enlarge the disk. Uploads will start failing |
| `auth.failed_logins` | 50 or more failed logins in 15 minutes | Someone may be guessing passwords. Look at Logins → Security history for the address |
| `db.connections` | Over 80% of database connections in use | Something is holding connections. Restart the services; if it returns, raise `max_connections` |
| `db.migrations` | The database is behind the code | Run `alembic upgrade head` (the Docker image does this at start) |
| `realtime.listener` | Live updates lost their database connection | It reconnects by itself and catches up. If it stays, restart the platform service |
| `configuration` | A weak `AUTH_SECRET` in production | Set a proper one |

The Super Admin gets a notification when an alert opens, and once more if it turns critical. An alert closes by itself when the cause is gone. There is no email or SMS alerting: if the whole server is down, nothing here can tell you. Use an outside uptime check on `https://<your domain>/api/v1/health/ready` for that.

## Health addresses

| Address | Answer |
|---|---|
| `/api/v1/health` | `200` if the process is alive |
| `/api/v1/health/ready` | `200` if the database is reachable and migrations are applied, otherwise `503` |

## Logs

One JSON line per request on standard output, with `request_id`, method, path, status and time. No passwords, tokens or message contents are logged. In Docker: `docker compose logs -f platform`.

## Starting, stopping, upgrading

```
docker compose up -d --build        # start or upgrade; migrations run before the service accepts requests
docker compose stop platform        # the worker finishes the pass in hand first
docker compose logs -f platform
```

Stopping loses nothing: queued notifications and jobs are in the database and continue after the restart; open apps reconnect and receive what they missed.

## Things that are deliberately not possible

- No screen or API runs SQL or a command.
- A job can only be one of the built-in kinds, with numbers inside fixed limits.
- The server only ever sends push to known push services and to Apple.
- Nobody below the Super Admin can act on someone of their own or a higher level.
