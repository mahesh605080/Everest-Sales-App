"""Read-only view of the database for the Super Admin: what tables exist, how big, which indexes are used, where migrations stand.
There is no SQL box. Table and column names are taken from the database's own catalogue, never from the request text."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Principal, super_admin
from ..errors import ApiError
from .health import migration_status

router = APIRouter(prefix="/admin/db", tags=["admin: database"])
SCHEMAS = ("public", "platform")
# Columns whose contents are never shown, in any table.
HIDDEN = {"password_hash", "token_hash", "p256dh", "auth", "auth_key", "endpoint", "secret", "refresh_token", "access_token", "data_bytes", "bytes"}


@router.get("/overview", summary="Database size, connections, migration state and every table with its size")
def overview(_: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    tables = db.execute(text("""
        select n.nspname as schema, c.relname as "table", greatest(c.reltuples, 0)::bigint as rows_estimate, pg_total_relation_size(c.oid) as bytes,
               coalesce(s.seq_scan, 0) as seq_scans, coalesce(s.idx_scan, 0) as index_scans
          from pg_class c join pg_namespace n on n.oid = c.relnamespace left join pg_stat_user_tables s on s.relid = c.oid
         where c.relkind = 'r' and n.nspname = any(:s) order by pg_total_relation_size(c.oid) desc"""), {"s": list(SCHEMAS)}).mappings().all()
    size = db.execute(text("select pg_database_size(current_database())")).scalar()
    conns = db.execute(text("select count(*) filter (where state = 'active') as active, count(*) as total from pg_stat_activity where datname = current_database()")).mappings().first()
    return {"database_bytes": size, "connections": dict(conns), "version": db.execute(text("show server_version")).scalar(), "migrations": migration_status(db), "tables": [dict(t) for t in tables]}


@router.get("/indexes", summary="Every index with how often it has been used; an index never used is a candidate for removal")
def indexes(_: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    rows = db.execute(text("""
        select s.schemaname as schema, s.relname as "table", s.indexrelname as index, s.idx_scan as scans, pg_relation_size(s.indexrelid) as bytes, i.indisunique as "unique", i.indisprimary as "primary"
          from pg_stat_user_indexes s join pg_index i on i.indexrelid = s.indexrelid where s.schemaname = any(:s) order by s.schemaname, s.relname, s.indexrelname"""), {"s": list(SCHEMAS)}).mappings().all()
    return {"indexes": [dict(r) for r in rows]}


def _columns(db: Session, schema: str, table: str) -> list[dict]:
    if schema not in SCHEMAS:
        raise ApiError(404, "Unknown table.", "not_found")
    cols = db.execute(text("select column_name, data_type, is_nullable = 'YES' as nullable from information_schema.columns where table_schema = :s and table_name = :t order by ordinal_position"),
                      {"s": schema, "t": table}).mappings().all()
    if not cols:
        raise ApiError(404, "Unknown table.", "not_found")
    return [dict(c) for c in cols]


@router.get("/tables/{schema}/{table}", summary="Columns and a page of records, newest first. Secret columns are masked.")
def records(schema: str, table: str, _: Principal = Depends(super_admin), db: Session = Depends(get_db), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100000)):
    cols = _columns(db, schema, table)
    pk = db.execute(text("""select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
                             where i.indrelid = cast(:r as regclass) and i.indisprimary order by a.attnum limit 1"""), {"r": f'"{schema}"."{table}"'}).scalar()
    shown = [c["column_name"] for c in cols if c["column_name"] not in HIDDEN and c["data_type"] != "bytea"]
    # Identifiers come from information_schema (checked above) and are quoted; nothing from the request is placed in the statement.
    sel = ", ".join(f'"{c}"' for c in shown)
    order = f'order by "{pk}" desc' if pk else ""
    rows = db.execute(text(f'select {sel} from "{schema}"."{table}" {order} limit :l offset :o'), {"l": limit, "o": offset}).mappings().all()  # noqa: S608
    return {"columns": [{**c, "hidden": c["column_name"] in HIDDEN or c["data_type"] == "bytea"} for c in cols], "rows": [dict(r) for r in rows], "limit": limit, "offset": offset}
