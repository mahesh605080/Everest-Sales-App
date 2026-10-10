# Deployment, backup and restore

## What has and has not been run

| | State |
|---|---|
| Both services running directly on Linux against PostgreSQL 16 | **Tested** throughout the project: every test in the reports ran this way |
| Backup, test restore, and full restore scripts | **Tested** on that setup, including damaged and incomplete backups (Phase 9 report) |
| `docker-compose.yml` | Checked for syntax and settings with `docker compose config`. **The images have never been built or started**: the build machine could not download base images. Expect to fix small things on the first `docker compose up`; the likely places are listed at the end |
| A server on the internet with a real domain and certificate | **Never done** |

## What you need

- A Linux server (2 CPU cores and 4 GB memory is enough for a few hundred people; see `PERFORMANCE.md`), with Docker and the compose plugin.
- A domain name whose DNS A record points at the server. https is required: browsers allow location and push only on https.
- Ports 80 and 443 open to the internet; SSH from your own addresses only. Nothing else.
- A second place for backups: another server, or storage the server can copy to.

## First start

```bash
git clone https://github.com/mahesh605080/Everest-Sales-App.git && cd Everest-Sales-App
cp .env.example .env && chmod 600 .env
```

Edit `.env`. The lines that must be set:

```
DOMAIN=sales.yourcompany.com.np
DB_PASSWORD=<openssl rand -hex 24>
AUTH_SECRET=<openssl rand -hex 32>
CRON_SECRET=<openssl rand -hex 16>
DEFAULT_USER_PASSWORD=<a temporary password for the first admin>
```

Then:

```bash
docker compose up -d --build
docker compose ps                      # all of db, app, platform, caddy should be "running"; platform "healthy"
curl -s https://$DOMAIN/api/v1/health/ready
```

Open the site, log in as `ADMIN` with the temporary password, and change it when asked.

Browser push (optional, recommended):

```bash
docker compose run --rm --no-deps platform python -m app.cli vapid     # prints three lines
# paste them into .env, set VAPID_SUBJECT to a real mail address, then:
docker compose up -d platform
```

Then open **Platform console → Overview**: "Configuration to fix" should list only what you chose to leave off.

## Backup

One command makes one complete backup: the database (taken from a single moment, so it is consistent even while people work), the uploaded files, a list of how many records each table holds, and checksums.

```bash
docker compose run --rm backup                                   # writes ./backups/<date>T<time>Z/
docker compose run --rm backup sh /scripts/verify-backup.sh      # restores the newest into a throw-away database, compares every table's record count, checks the files, then removes it
```

Schedule both from the server's cron (`crontab -e`), and copy the result off the server:

```
30 1 * * *  cd /path/to/Everest-Sales-App && docker compose run --rm backup >> backups/backup.log 2>&1 && rsync -a --delete backups/ backupuser@other-server:/srv/everest-backups/
30 2 * * 0  cd /path/to/Everest-Sales-App && docker compose run --rm backup sh /scripts/verify-backup.sh >> backups/backup.log 2>&1
```

- The 14 newest backups are kept (`BACKUP_KEEP`). Older ones are deleted only after a new one has succeeded.
- A backup contains everything, including password hashes. The folder is created readable by its owner only. Keep it on an encrypted disk; the script does not encrypt.
- In production the console shows the last backup and the last test restore on the Overview, and raises an alert if there has been no backup for 36 hours, no test restore for 8 days, or a test restore failed.

Without Docker the same scripts run directly: `DATABASE_URL=… FILES_DIR=… BACKUP_DIR=… sh scripts/backup.sh`. They need `pg_dump`, `pg_restore` and `psql` of the server's PostgreSQL version or newer.

## Restore

**To a new server** (the old one is gone):

```bash
# install as in "First start" up to and including editing .env, with the SAME AUTH_SECRET as before, then:
docker compose up -d db                                           # only the database
mkdir -p backups && rsync -a backupuser@other-server:/srv/everest-backups/ backups/
docker compose run --rm backup sh /scripts/restore.sh 20261010T013000Z
docker compose up -d --build
```

**Over the existing data** (to go back to last night):

```bash
docker compose stop app platform
RESTORE_REPLACE=sfa docker compose run --rm backup sh /scripts/restore.sh 20261010T013000Z
docker compose up -d
```

- Without `RESTORE_REPLACE` set to the database's exact name (`sfa` in Docker), the script refuses to touch a database that already has tables.
- With it, the backup is first restored into a **new database beside the old one** and every table's record count is compared with the backup's list. Only if that is right are the two swapped by renaming. If anything fails before the swap, the live database has not been touched.
- **The old database is kept**, under the name `sfa_before_<time>`, and the script prints the command to remove it. Remove it when you are sure; until then it takes disk space.
- Uploaded files from the backup are put back into the files folder. Files uploaded after the backup stay on disk; no record points at them any more.
- The script checks the backup's checksums before doing anything.
- With the same `AUTH_SECRET`, people who were logged in at backup time stay logged in. With a different one, everyone logs in again.
- Work done after the backup was taken is not in the restored database (it is still in the kept one). Phones that saved orders offline in that time will send them again when they reconnect.
- The swap needs nobody connected, which is why the two services are stopped first; a connection that is still open is closed by the script.

**Practise this once before going live**, on a spare machine, and time it.

## Upgrading

```bash
docker compose run --rm backup            # always first
git pull
docker compose up -d --build              # each service applies its own database changes before it starts serving
```

Database changes in this project only add (tables, columns, indexes); they do not drop or rewrite existing data.

## Going back after a bad upgrade

```bash
git log --oneline -5                                   # find the commit that was running before
git diff --stat <that commit> HEAD -- backend/migrations/versions      # did the upgrade add platform database changes?
```

If that last command lists new files, undo those database changes first, **while the newer code is still checked out** (only it knows how):

```bash
docker compose run --rm --no-deps platform python -m alembic downgrade <the highest number that existed before, e.g. 0006>
```

This removes the tables the upgrade added, with whatever was put in them since. Then:

```bash
git checkout <that commit>
docker compose up -d --build
```

If you skip the downgrade, the older platform code refuses to start because the database is at a version it does not know. The web app's own database changes need no undoing: its older code ignores newer columns.

Restore a backup only if data itself was damaged.

## Running without Docker

This is the setup that was actually tested.

```bash
# web app
npm ci && npm run build && npm run migrate && npm run seed && npm start                       # port 3000
# platform, in backend/
python -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python -m alembic upgrade head
.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000 --proxy-headers
```

Both read the same `DATABASE_URL` and `AUTH_SECRET`. Put a reverse proxy with https in front: `/api/v1/*` and `/ws` to port 8000, everything else to port 3000 (the `Caddyfile` shows the rule). Run **one** platform process: live connections are held in memory by that process. Use a process supervisor (systemd) so both restart after a reboot; on stop it must send SIGTERM and wait, and the platform then finishes the work in hand (checked: it exits within about two seconds).

## Where the first `docker compose up` is most likely to need attention

1. **Web image build** (`Dockerfile`): `npm ci` needs the lock file to match `package.json`; it does in the repository.
2. **Platform start order**: the platform waits for the database and the web app container to start, then runs its migrations. If its first health checks fail, `docker compose logs platform` shows why; it retries.
3. **Certificate**: Caddy can only get one when the domain already points at the server and ports 80 and 443 are reachable.
4. **Backup image**: the scripts were tested with the standard shell tools; in the small `postgres:16-alpine` image the same tools come from BusyBox. If one behaves differently, the script stops with an error rather than writing a bad backup.
5. **File permissions on `./backups`**: created by the container as root; adjust if your copy job runs as another user.

Please report what you had to change so this section can be replaced by "tested".
