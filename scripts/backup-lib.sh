# Shared by backup.sh, verify-backup.sh and restore.sh. Plain POSIX sh so it runs in the small postgres image too.

# One row per table with its exact number of records, for the web app's and the platform's tables.
COUNTS_SQL="select table_schema || '.' || table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text from information_schema.tables where table_schema in ('public', 'platform') and table_type = 'BASE TABLE' order by 1"

export PGOPTIONS="${PGOPTIONS:-} -c client_min_messages=warning"
die() { echo "ERROR: $*" >&2; exit 1; }
need() { for c in "$@"; do command -v "$c" >/dev/null 2>&1 || die "'$c' is not installed"; done; }
now_utc() { date -u +%Y-%m-%dT%H:%M:%SZ; }

# Writes one platform setting. Used to record when the last backup and the last test restore happened; never holds a secret.
note() { # key label json
  psql -qXAt -v ON_ERROR_STOP=1 "$DATABASE_URL" -v k="$1" -v l="$2" -v v="$3" <<'SQL' >/dev/null 2>&1 || echo "note: could not record '$1' in the database (is the platform schema installed?)" >&2
insert into platform.settings(key, value, label) values (:'k', :'v', :'l') on conflict (key) do update set value = excluded.value, updated_at = now();
SQL
}

# The same database server, another database name. DATABASE_URL must be of the form postgresql://[user[:password]@][host][:port]/dbname[?options].
with_db() { # url name
  case "$1" in
    postgres://*/*|postgresql://*/*) echo "$1" | sed -E "s#^(postgres(ql)?://[^/?]*)/[^?]*#\1/$2#" ;;
    *) die "DATABASE_URL must look like postgresql://user:password@host:port/dbname" ;;
  esac
}
# Stops unless the address really leads to the database we mean to touch. Guards every step that creates, fills or renames one.
must_be() { # url expected-name
  got=$(psql -qXAt "$1" -c "select current_database()" 2>/dev/null) || die "cannot connect to database '$2'"
  [ "$got" = "$2" ] || die "expected to be connected to '$2' but this address leads to '$got'; nothing was changed"
}
# The newest finished backup's name.
newest() { ls -1d "$BACKUP_DIR"/[0-9]*T[0-9]*Z 2>/dev/null | sort | tail -n 1 | sed 's#.*/##'; }
case "${BACKUP_DIR:-}" in *"'"*) die "BACKUP_DIR must not contain a quote character" ;; esac
