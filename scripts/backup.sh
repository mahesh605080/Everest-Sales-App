#!/bin/sh
# Makes one complete backup: the database and the uploaded files, with a list of record counts and checksums.
#
#   DATABASE_URL=postgresql://...  FILES_DIR=/path/to/files  BACKUP_DIR=/path/to/backups  sh scripts/backup.sh
#
# BACKUP_KEEP (default 14, at least 1) is how many backups to keep; older ones are deleted after a new one has succeeded.
# The backup contains everything, including password hashes. Keep BACKUP_DIR private and copy it off this server.
set -eu
. "$(dirname "$0")/backup-lib.sh"
need pg_dump psql tar sha256sum
: "${DATABASE_URL:?set DATABASE_URL}" "${BACKUP_DIR:?set BACKUP_DIR}"
FILES_DIR="${FILES_DIR:-}"; KEEP="${BACKUP_KEEP:-14}"
case "$KEEP" in ''|*[!0-9]*|0) die "BACKUP_KEEP must be a whole number, 1 or more (got '$KEEP')" ;; esac
umask 077
stamp=$(date -u +%Y%m%dT%H%M%SZ); final="$BACKUP_DIR/$stamp"; work="$final.partial"
fifo="$work/.ctl"; out="$work/.snap"
mkdir -p "$work"
trap 'rm -rf "$work" 2>/dev/null' EXIT

# One database session holds a snapshot open. The dump and the record counts both read from that same moment,
# so the counts describe exactly what is in the dump, even while people keep working.
mkfifo "$fifo"
psql -qXAt -v ON_ERROR_STOP=1 "$DATABASE_URL" < "$fifo" > "$out" 2>"$work/.err" &
ctl=$!
exec 3> "$fifo"
echo "begin isolation level repeatable read read only; select pg_export_snapshot();" >&3
i=0; while [ ! -s "$out" ] && [ $i -lt 100 ]; do sleep 0.1; i=$((i + 1)); done
snap=$(head -n 1 "$out"); [ -n "$snap" ] || die "could not open a database snapshot: $(cat "$work/.err")"

pg_dump --snapshot="$snap" --format=custom --no-owner --no-privileges --file "$work/database.dump" "$DATABASE_URL"
echo "\\o '$work/rowcounts.tsv'" >&3; echo "$COUNTS_SQL;" >&3; echo "\\o" >&3
echo "select 'platform ' || version_num from platform.alembic_version union all select 'web ' || max(name) from public.schema_migrations;" >&3
echo "commit;" >&3; exec 3>&-; wait "$ctl" || die "the snapshot session failed: $(cat "$work/.err")"
tail -n +2 "$out" > "$work/versions.txt"
[ -s "$work/rowcounts.tsv" ] || die "no record counts were written"

files=0
if [ -n "$FILES_DIR" ] && [ -d "$FILES_DIR" ]; then
  # tar answers 1 when a file changed while it was being read (somebody uploading right now). That file is in the next backup; anything worse stops here.
  tar -C "$FILES_DIR" -czf "$work/files.tar.gz" . || { rc=$?; [ "$rc" -eq 1 ] && echo "note: a file changed while it was being read" >&2 || die "could not archive $FILES_DIR"; }
  tar -tzf "$work/files.tar.gz" > "$work/.list"; files=$(grep -vc '/$' "$work/.list" || true)
else
  echo "note: FILES_DIR is not set or does not exist; uploaded files are NOT in this backup" >&2
fi
echo "$files" > "$work/files.count"
rm -f "$fifo" "$out" "$work/.err" "$work/.list"
(cd "$work" && sha256sum database.dump rowcounts.tsv versions.txt files.count $( [ -f files.tar.gz ] && echo files.tar.gz ) > SHA256SUMS)
mv "$work" "$final"     # only a finished backup ever has a plain name
trap - EXIT

db_bytes=$(wc -c < "$final/database.dump" | tr -d ' '); f_bytes=0; [ -f "$final/files.tar.gz" ] && f_bytes=$(wc -c < "$final/files.tar.gz" | tr -d ' ')
tables=$(wc -l < "$final/rowcounts.tsv" | tr -d ' '); rows=$(awk -F'|' '{s += $2} END {print s + 0}' "$final/rowcounts.tsv")
note backup.last "Last backup" "{\"at\":\"$(now_utc)\",\"name\":\"$stamp\",\"database_bytes\":$db_bytes,\"files_bytes\":$f_bytes,\"files\":$files,\"tables\":$tables,\"rows\":$rows}"

# Old backups go only now, after the new one is safely in place. Unfinished ones go too, but only when more than a day old:
# a younger one may belong to another backup that is still running.
find "$BACKUP_DIR" -maxdepth 1 -name '*.partial' -mmin +1440 -exec rm -rf {} + 2>/dev/null || true
ls -1d "$BACKUP_DIR"/[0-9]*T[0-9]*Z 2>/dev/null | sort -r | tail -n +"$((KEEP + 1))" | while IFS= read -r d; do rm -rf "$d"; done
echo "backup $stamp: $tables tables, $rows records, $files files, database $db_bytes bytes, files $f_bytes bytes -> $final"
