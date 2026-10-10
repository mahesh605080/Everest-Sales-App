"""A document store with declared fields: validated on the way in, filtered only on declared fields, limited in size and number.
It is PostgreSQL JSONB behind explicit rules, not a free-form query endpoint."""
import json
import re
import uuid
from datetime import date, datetime

from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..db import SCHEMA
from ..deps import Principal
from ..errors import ApiError
from ..models.data import Collection, Document

NAME = re.compile(r"^[a-z][a-z0-9_]{1,39}$")
TYPES = {"string", "text", "integer", "number", "boolean", "date", "datetime", "enum", "json"}
MAX_FIELDS, MAX_LIMIT, MAX_OFFSET = 40, 100, 10000
MANAGE = "data.manage"  # may read and change every document of every collection


def clean_fields(fields: list) -> list:
    if not isinstance(fields, list) or not fields or len(fields) > MAX_FIELDS:
        raise ApiError(422, f"Give between 1 and {MAX_FIELDS} fields.", "invalid_request")
    out, seen = [], set()
    for f in fields:
        n, t = str(f.get("name", "")), f.get("type")
        if not NAME.match(n) or n in seen:
            raise ApiError(422, f"Field name '{n}' must be lower-case letters, digits and underscores, and unique.", "invalid_request")
        if t not in TYPES:
            raise ApiError(422, f"Field '{n}': type must be one of {', '.join(sorted(TYPES))}.", "invalid_request")
        item = {"name": n, "type": t, "required": bool(f.get("required"))}
        if t in ("string", "text"):
            item["max"] = max(1, min(int(f.get("max") or (200 if t == "string" else 5000)), 20000))
        if t == "enum":
            opts = [str(o) for o in (f.get("options") or [])][:50]
            if not opts:
                raise ApiError(422, f"Field '{n}': an enum needs options.", "invalid_request")
            item["options"] = opts
        seen.add(n)
        out.append(item)
    return out


def check_rule(rule: str, write: bool) -> str:
    if rule == "owner" or (rule == "authenticated" and not write) or re.match(r"^[a-z_]+\.[a-z_]+$", rule or ""):
        return rule
    raise ApiError(422, "A rule is 'owner', 'authenticated' (reading only) or a permission such as 'reports.run'.", "invalid_request")


def get_collection(db: Session, name: str) -> Collection:
    c = db.get(Collection, name) if NAME.match(name or "") else None
    if not c or not c.active:
        raise ApiError(404, "This collection does not exist.", "not_found")
    return c


def _coerce(f: dict, v):
    t, n = f["type"], f["name"]
    bad = ApiError(422, f"{n}: not a valid {t}.", "invalid_request", {n: f"not a valid {t}"})
    if t in ("string", "text", "enum"):
        if not isinstance(v, str):
            raise bad
        if t == "enum" and v not in f["options"]:
            raise ApiError(422, f"{n}: must be one of {', '.join(f['options'])}.", "invalid_request", {n: "not an allowed value"})
        if t != "enum" and len(v) > f["max"]:
            raise ApiError(422, f"{n}: at most {f['max']} characters.", "invalid_request", {n: "too long"})
        return v
    if t == "boolean":
        if not isinstance(v, bool):
            raise bad
        return v
    if t == "integer":
        if isinstance(v, bool) or not isinstance(v, int):
            raise bad
        return v
    if t == "number":
        if isinstance(v, bool) or not isinstance(v, int | float) or v != v or v in (float("inf"), float("-inf")):
            raise bad
        return v
    if t == "date":
        try:
            if not isinstance(v, str) or len(v) != 10:
                raise ValueError
            return date.fromisoformat(v).isoformat()
        except ValueError as e:
            raise bad from e
    if t == "datetime":
        try:
            if not isinstance(v, str):
                raise ValueError
            return datetime.fromisoformat(v.replace("Z", "+00:00")).isoformat()
        except ValueError as e:
            raise bad from e
    return v  # json: any JSON value, bounded by the document size limit


def validate(c: Collection, data: dict, partial: bool = False) -> dict:
    if not isinstance(data, dict):
        raise ApiError(422, "The document must be an object.", "invalid_request")
    spec = {f["name"]: f for f in c.fields}
    unknown = [k for k in data if k not in spec]
    if unknown:
        raise ApiError(422, f"Unknown field: {unknown[0]}.", "invalid_request", {unknown[0]: "not a field of this collection"})
    out = {}
    for n, f in spec.items():
        if n not in data or data[n] is None:
            if f["required"] and (not partial or n in data):
                raise ApiError(422, f"{n} is required.", "invalid_request", {n: "required"})
            if n in data:
                out[n] = None
            continue
        out[n] = _coerce(f, data[n])
    return out


def _size_ok(c: Collection, data: dict):
    if len(json.dumps(data, separators=(",", ":")).encode()) > c.max_doc_bytes:
        raise ApiError(413, f"The document is larger than this collection allows ({c.max_doc_bytes} bytes).", "too_large")


def can_read_all(c: Collection, p: Principal) -> bool:
    return p.can(MANAGE) or c.read_rule == "authenticated" or (c.read_rule != "owner" and p.can(c.read_rule))


def can_write(c: Collection, p: Principal, doc: Document | None = None) -> bool:
    if p.can(MANAGE):
        return True
    if c.write_rule == "owner":
        return doc is None or doc.owner_id == p.id
    return p.can(c.write_rule)


def view(d: Document) -> dict:
    return {"id": str(d.id), "owner_id": d.owner_id, "data": d.data, "version": d.version, "created_at": d.created_at, "updated_at": d.updated_at}


def create(db: Session, c: Collection, p: Principal, data: dict) -> Document:
    if not can_write(c, p):
        raise ApiError(403, "Your role does not allow writing to this collection.", "forbidden")
    clean = validate(c, data)
    _size_ok(c, clean)
    n = db.scalar(select(func.count()).select_from(Document).where(Document.collection == c.name, Document.owner_id == p.id, Document.deleted_at.is_(None)))
    if n >= c.max_docs_per_user:
        raise ApiError(409, f"You have reached the limit of {c.max_docs_per_user} documents in this collection.", "quota_exceeded")
    d = Document(collection=c.name, owner_id=p.id, data=clean, updated_by=p.id)
    db.add(d)
    db.flush()
    _audit(db, c, p, "create", d, None)
    return d


def fetch(db: Session, c: Collection, p: Principal, doc_id: str, for_update: bool = False) -> Document:
    try:
        key = uuid.UUID(str(doc_id))
    except ValueError as e:
        raise ApiError(404, "This document does not exist.", "not_found") from e
    q = select(Document).where(Document.id == key, Document.collection == c.name, Document.deleted_at.is_(None))
    d = db.scalar(q.with_for_update() if for_update else q)
    # Somebody else's private document looks exactly like one that does not exist.
    if d is None or (not can_read_all(c, p) and d.owner_id != p.id):
        raise ApiError(404, "This document does not exist.", "not_found")
    return d


def update(db: Session, c: Collection, p: Principal, doc_id: str, data: dict, if_version: int | None) -> Document:
    d = fetch(db, c, p, doc_id, for_update=True)
    if not can_write(c, p, d):
        raise ApiError(403, "Your role does not allow changing this document.", "forbidden")
    if if_version is not None and if_version != d.version:
        raise ApiError(409, "Somebody changed this document after you opened it. Reload and try again.", "version_conflict")
    before = dict(d.data)
    merged = {**d.data, **validate(c, data, partial=True)}
    for f in c.fields:  # a required field cannot be blanked by a partial update
        if f["required"] and merged.get(f["name"]) is None:
            raise ApiError(422, f"{f['name']} is required.", "invalid_request", {f["name"]: "required"})
    _size_ok(c, merged)
    d.data, d.version, d.updated_at, d.updated_by = merged, d.version + 1, func.now(), p.id
    db.flush()
    db.refresh(d)
    _audit(db, c, p, "update", d, before)
    return d


def delete(db: Session, c: Collection, p: Principal, doc_id: str) -> Document:
    d = fetch(db, c, p, doc_id, for_update=True)
    if not can_write(c, p, d):
        raise ApiError(403, "Your role does not allow deleting this document.", "forbidden")
    d.deleted_at, d.updated_by = func.now(), p.id
    db.flush()
    _audit(db, c, p, "delete", d, dict(d.data))
    return d


_OPS = {"": "=", "gte": ">=", "lte": "<=", "gt": ">", "lt": "<"}


def search(db: Session, c: Collection, p: Principal, filters: dict[str, str], q: str | None, sort: str | None, limit: int, offset: int, mine: bool) -> dict:
    limit, offset = max(1, min(limit, MAX_LIMIT)), max(0, min(offset, MAX_OFFSET))
    spec = {f["name"]: f for f in c.fields}
    where, params = ["collection = :c", "deleted_at is null"], {"c": c.name}
    if mine or not can_read_all(c, p):
        where.append("owner_id = :me")
        params["me"] = p.id
    contain: dict = {}
    for i, (key, raw) in enumerate(filters.items()):
        name, _, op = key.partition(".")
        f = spec.get(name)
        if not f or op not in (*_OPS, "in") or f["type"] in ("json", "text"):
            raise ApiError(422, f"Cannot filter on '{key}'. Filter on a declared field with: (nothing), gte, lte, gt, lt, in.", "invalid_request")
        cast = "numeric" if f["type"] in ("integer", "number") else "boolean" if f["type"] == "boolean" else "text"

        def conv(v: str, f=f):
            try:
                return _coerce(f, int(v) if f["type"] == "integer" else float(v) if f["type"] == "number" else (v.lower() == "true") if f["type"] == "boolean" else v)
            except ValueError as e:
                raise ApiError(422, f"{f['name']}: '{v}' is not a valid {f['type']}.", "invalid_request") from e
        if op == "":
            contain[name] = conv(raw)  # equality uses the JSONB index
        elif op == "in":
            vals = [conv(v) for v in raw.split(",")[:50]]
            where.append(f"(data->>'{name}')::{cast} = any(:v{i})")  # noqa: S608 the field name was checked against the declared fields
            params[f"v{i}"] = vals
        else:
            where.append(f"(data->>'{name}')::{cast} {_OPS[op]} :v{i}")  # noqa: S608
            params[f"v{i}"] = conv(raw)
    if contain:
        where.append("data @> cast(:contain as jsonb)")
        params["contain"] = json.dumps(contain)
    if q and q.strip():
        texts = [n for n, f in spec.items() if f["type"] in ("string", "text")][:8]
        if texts:
            where.append("(" + " or ".join(f"data->>'{n}' ilike :q" for n in texts) + ")")  # noqa: S608
            params["q"] = "%" + q.strip()[:100].replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    order = "created_at desc, id"
    if sort:
        name, desc = sort.lstrip("-"), sort.startswith("-")
        if name in ("created_at", "updated_at"):
            order = f"{name} {'desc' if desc else 'asc'}, id"
        elif name in spec and spec[name]["type"] not in ("json", "text"):
            cast = "numeric" if spec[name]["type"] in ("integer", "number") else "text"
            order = f"(data->>'{name}')::{cast} {'desc' if desc else 'asc'} nulls last, id"  # noqa: S608
        else:
            raise ApiError(422, f"Cannot sort by '{name}'.", "invalid_request")
    w = " and ".join(where)
    total = db.execute(text(f"select count(*) from {SCHEMA}.documents where {w}"), params).scalar_one()  # noqa: S608
    rows = db.execute(text(f"select id, owner_id, data, version, created_at, updated_at from {SCHEMA}.documents where {w} order by {order} limit :lim offset :off"),  # noqa: S608
                      {**params, "lim": limit, "off": offset}).mappings().all()
    return {"items": [{**r, "id": str(r["id"])} for r in rows], "total": total, "limit": limit, "offset": offset}


def _audit(db: Session, c: Collection, p: Principal, action: str, d: Document, before: dict | None):
    if c.audited:
        db.execute(text("insert into public.audit_logs(user_id, user_name, action, entity, entity_id, before, after) values (:u, :n, :a, :e, :i, cast(:b as jsonb), cast(:af as jsonb))"),
                   {"u": p.id, "n": p.name, "a": action, "e": f"doc:{c.name}", "i": str(d.id), "b": json.dumps(before) if before is not None else None, "af": json.dumps(d.data) if action != "delete" else None})
