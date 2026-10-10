#!/bin/sh
# Puts a backup back: the database, and the uploaded files.
#
#   DATABASE_URL=postgresql://...target...  FILES_DIR=/path/to/files  BACKUP_DIR=/path/to/backups  sh scripts/restore.sh <backup-name>
#
# Into an empty database it simply restores.
# A database that already has tables is refused unless RESTORE_REPLACE is set to that database's exact name. With it set, the backup is first
# restored into a new database beside the old one and checked; only then are the two swapped by renaming. The old database is KEPT under the name
# "<name>_before_<time>" until you drop it yourself, so a restore never destroys anything. Stop both services first: the swap needs nobody connected.
set -eu
. "$(dirname "$0")/backup-lib.sh"
need pg_restore psql tar sha256sum
: "${DATABASE_URL:?set DATABASE_URL}" "${BACKUP_DIR:?set BACKUP_DIR}"
name="${1:?give the backup name, e.g. 20261010T013000Z (ls \$BACKUP_DIR)}"; b="$BACKUP_DIR/$name"
[ -d "$b" ] || die "no such backup: $b"
(cd "$b" && sha256sum -c SHA256SUMS >/dev/null 2>&1) || die "a file in the backup is damaged or was changed (checksum mismatch); nothing was restored"
dbname=$(psql -qXAt "$DATABASE_URL" -c "select current_database()") || die "cannot connect to the target database"
existing=$(psql -qXAt "$DATABASE_URL" -c "select count(*) from information_schema.tables where table_schema in ('public', 'platform')")
replace=0; [ "${RESTORE_REPLACE:-}" = "$dbname" ] && replace=1
if [ "$existing" != "0" ] && [ "$replace" != 1 ]; then
  die "database '$dbname' already has $existing tables. To put this backup in its place (the present contents are kept under another name), run again with RESTORE_REPLACE=$dbname"
fi
# Everything that could make us stop is checked before anything is changed.
if [ -f "$b/files.tar.gz" ]; then
  : "${FILES_DIR:?this backup has uploaded files; set FILES_DIR to where they belong}"
  mkdir -p "$FILES_DIR"
  if [ -n "$(ls -A "$FILES_DIR" 2>/dev/null)" ] && [ "$replace" != 1 ]; then die "$FILES_DIR is not empty; set RESTORE_REPLACE=$dbname to put the backup's files into it"; fi
fi
tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
load() { # url
  pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname "$1" "$b/database.dump" || return 1
  psql -qXAt -v ON_ERROR_STOP=1 "$1" -c "$COUNTS_SQL" > "$tmp/counts" || return 1
  diff "$b/rowcounts.tsv" "$tmp/counts" >/dev/null
}

if [ "$existing" = "0" ]; then
  load "$DATABASE_URL" || die "the backup could not be restored completely into '$dbname'. It was empty before and may be partly filled now; drop and recreate it, then try again"
else
  stamp=$(date -u +%Y%m%dt%H%M%S); new="${dbname}_restoring_$stamp"; old="${dbname}_before_$stamp"
  admin=$(with_db "$DATABASE_URL" postgres); must_be "$admin" postgres
  nurl=$(with_db "$DATABASE_URL" "$new")
  psql -qX -v ON_ERROR_STOP=1 "$admin" -c "create database \"$new\"" || die "could not create a database to restore into; nothing was changed"
  must_be "$nurl" "$new"
  if ! load "$nurl"; then
    psql -qX "$admin" -c "drop database if exists \"$new\" with (force)" >/dev/null 2>&1
    die "the backup could not be restored, or its record counts do not match. '$dbname' was not touched"
  fi
  # The backup is in and checked. Swap the names; anybody still connected is disconnected first.
  psql -qX -v ON_ERROR_STOP=1 "$admin" -c "select pg_terminate_backend(pid) from pg_stat_activity where datname in ('$dbname', '$new') and pid <> pg_backend_pid()" >/dev/null
  psql -qX -v ON_ERROR_STOP=1 "$admin" -c "alter database \"$dbname\" rename to \"$old\"" || { psql -qX "$admin" -c "drop database if exists \"$new\" with (force)" >/dev/null 2>&1; die "could not rename '$dbname' (is a service still running?). Nothing was changed"; }
  if ! psql -qX -v ON_ERROR_STOP=1 "$admin" -c "alter database \"$new\" rename to \"$dbname\""; then
    psql -qX "$admin" -c "alter database \"$old\" rename to \"$dbname\"" >/dev/null 2>&1
    die "could not put the restored database in place; the original was put back under its name. The restored copy is still there as '$new'"
  fi
  echo "the previous contents are kept as database '$old'. When you are sure, remove them with:  drop database \"$old\""
fi
rows=$(awk -F'|' '{s += $2} END {print s + 0}' "$b/rowcounts.tsv")
if [ -f "$b/files.tar.gz" ]; then
  tar -C "$FILES_DIR" -xzf "$b/files.tar.gz"   # files uploaded after the backup stay on disk; no record points at them any more
  # On a fresh volume the folder itself belongs to whoever ran this. Give it to the owner of the files in it, so the service can keep writing there.
  first=$(ls -A "$FILES_DIR" | head -n 1)
  if [ -n "$first" ] && [ "$(id -u)" = "0" ]; then chown "$(stat -c '%u:%g' "$FILES_DIR/$first")" "$FILES_DIR" 2>/dev/null || true; fi
fi
echo "restored $name into '$dbname': $rows records, $(cat "$b/files.count") files. Start the services now."
