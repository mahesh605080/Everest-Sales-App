#!/bin/sh
# Proves a backup can be restored: checks its checksums, restores it into a throw-away database on the same server,
# compares the number of records in every table with what was counted when the backup was made, checks the file archive, then removes the throw-away database.
#
#   DATABASE_URL=postgresql://...  BACKUP_DIR=/path/to/backups  sh scripts/verify-backup.sh [backup-name]      (default: the newest)
#
# The live database's own tables are never changed: the script only creates and drops its throw-away database on the same server,
# and writes one line of result into the platform's settings. Exit code 0 means the backup is good.
set -eu
. "$(dirname "$0")/backup-lib.sh"
need pg_restore psql tar sha256sum
: "${DATABASE_URL:?set DATABASE_URL}" "${BACKUP_DIR:?set BACKUP_DIR}"
name="${1:-$(newest)}"
[ -n "$name" ] && [ -d "$BACKUP_DIR/$name" ] || die "no backup found in $BACKUP_DIR"
b="$BACKUP_DIR/$name"; scratch="verify_$(echo "$name" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_')_$$"; surl=$(with_db "$DATABASE_URL" "$scratch")
tmp=$(mktemp -d); created=0
cleanup() { [ "$created" = 1 ] && psql -qX "$DATABASE_URL" -c "drop database if exists \"$scratch\" with (force)" >/dev/null 2>&1; rm -rf "$tmp"; }
trap cleanup EXIT
fail() { note backup.verified "Last test restore" "{\"at\":\"$(now_utc)\",\"name\":\"$name\",\"ok\":false,\"reason\":\"$1\"}"; die "$1"; }

(cd "$b" && sha256sum -c SHA256SUMS >/dev/null 2>&1) || fail "a file in the backup is damaged or was changed (checksum mismatch)"
psql -qX -v ON_ERROR_STOP=1 "$DATABASE_URL" -c "create database \"$scratch\"" || fail "could not create the throw-away database"
created=1
must_be "$surl" "$scratch"    # never restore anywhere but the throw-away database
pg_restore --no-owner --no-privileges --exit-on-error --single-transaction --dbname "$surl" "$b/database.dump" || fail "the database dump could not be restored"
psql -qXAt -v ON_ERROR_STOP=1 "$surl" -c "$COUNTS_SQL" > "$tmp/counts" || fail "could not count the restored records"
if ! diff "$b/rowcounts.tsv" "$tmp/counts" > "$tmp/diff"; then head -n 20 "$tmp/diff" >&2; fail "record counts after restoring differ from the counts taken at backup time"; fi
ver=$(psql -qXAt -v ON_ERROR_STOP=1 "$surl" -c "select 'platform ' || version_num from platform.alembic_version union all select 'web ' || max(name) from public.schema_migrations") || fail "could not read the restored database's versions"
[ "$ver" = "$(cat "$b/versions.txt")" ] || fail "database versions after restoring differ from the backup's record"
tables=$(wc -l < "$tmp/counts" | tr -d ' '); rows=$(awk -F'|' '{s += $2} END {print s + 0}' "$tmp/counts")
files=$(cat "$b/files.count")
if [ -f "$b/files.tar.gz" ]; then
  tar -tzf "$b/files.tar.gz" > "$tmp/list" || fail "the file archive cannot be read"
  n=$(grep -vc '/$' "$tmp/list" || true)
  [ "$n" = "$files" ] || fail "the file archive holds $n files, the backup recorded $files"
  # every stored file the database knows about must be in the archive
  psql -qXAt -v ON_ERROR_STOP=1 "$surl" -c "select storage_key from platform.files where purged_at is null" > "$tmp/keys" || fail "could not read the list of stored files"
  sed 's#.*/##' "$tmp/list" | sort > "$tmp/have"
  missing=$(sort "$tmp/keys" | grep -vxFf "$tmp/have" | grep -c . || true)
  [ "$missing" = "0" ] || fail "$missing uploaded files recorded in the database are not in the file archive"
fi
note backup.verified "Last test restore" "{\"at\":\"$(now_utc)\",\"name\":\"$name\",\"ok\":true,\"tables\":$tables,\"rows\":$rows,\"files\":$files}"
echo "backup $name is good: restored $tables tables with $rows records, every count matches; $files files in the archive"
