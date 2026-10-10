import base64
import hashlib
import hmac
import re
import secrets
import time
import uuid

from sqlalchemy import func, or_, select, text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SCHEMA
from ..deps import Client, Principal
from ..errors import ApiError
from ..models.files import FileEvent, FileShare, StoredFile, UserQuota
from . import filetypes
from .storage import get_storage

MANAGE = "files.manage"  # may see and remove every file
USE = "files.use"
NOT_FOUND = ApiError(404, "This file does not exist.", "not_found")
SNIFF = 4096


def clean_name(raw: str) -> str:
    """The name is only a label. Directory parts and control characters are dropped; it is never used to build a path."""
    name = re.split(r"[\\/]", raw or "")[-1]
    name = "".join(ch for ch in name if ch.isprintable() and ch not in '<>:"|?*').strip(" .")
    return name[:200] or "file"


def clean_folder(raw: str | None) -> str:
    parts = [re.sub(r"[^\w .-]", "", p).strip(" .") for p in re.split(r"[\\/]+", raw or "")]
    return "/".join(p for p in parts if p and p not in (".", ".."))[:120]


def log(db: Session, file_id, action: str, user_id: int | None, client: Client | None = None, detail: str | None = None):
    db.add(FileEvent(file_id=file_id, user_id=user_id, action=action, detail=(detail or "")[:300] or None, ip=client.ip if client else None))


def quota(db: Session, user_id: int) -> dict:
    limit = db.scalar(select(UserQuota.bytes).where(UserQuota.user_id == user_id)) or get_settings().file_quota_bytes
    used, n = db.execute(select(func.coalesce(func.sum(StoredFile.size), 0), func.count()).where(StoredFile.owner_id == user_id, StoredFile.deleted_at.is_(None))).one()
    return {"limit_bytes": int(limit), "used_bytes": int(used), "files": int(n), "free_bytes": max(0, int(limit) - int(used))}


def view(f: StoredFile, p: Principal | None = None) -> dict:
    return {"id": str(f.id), "name": f.name, "folder": f.folder, "size": f.size, "content_type": f.content_type, "owner_id": f.owner_id, "ref_type": f.ref_type, "ref_id": f.ref_id,
            "created_at": f.created_at, "updated_at": f.updated_at, **({"mine": f.owner_id == p.id} if p else {})}


async def store(db: Session, p: Principal, upload, folder: str | None, ref_type: str | None, ref_id: str | None, client: Client) -> StoredFile:
    """Reads the upload in pieces, refusing it as soon as it is too large, and keeps it only if its content is an accepted type."""
    if not p.can(USE):
        raise ApiError(403, "Your role does not include file storage.", "forbidden")
    s = get_settings()
    name = clean_name(upload.filename or "")
    q = quota(db, p.id)
    key = secrets.token_hex(24)
    w = get_storage().writer(key)
    size, digest, head, small = 0, hashlib.sha256(), b"", bytearray()
    try:
        while chunk := await upload.read(65536):
            size += len(chunk)
            if size > s.file_max_bytes:
                raise ApiError(413, f"The file is larger than the limit of {s.file_max_bytes // (1024 * 1024)} MB.", "too_large")
            if size > q["free_bytes"]:
                raise ApiError(413, "This would go over your storage allowance. Delete files you no longer need.", "quota_exceeded")
            if len(head) < SNIFF:
                head += chunk[:SNIFF - len(head)]
            if size <= 2 * 1024 * 1024:
                small.extend(chunk)  # small enough to open as a zip when checking Office documents
            digest.update(chunk)
            w.write(chunk)
        if size == 0:
            raise ApiError(422, "The file is empty.", "invalid_request")
        ctype, why = filetypes.check(head, bytes(small) if size <= 2 * 1024 * 1024 else None, name)
        if ctype is None:
            raise ApiError(415, why, "unsupported_type")
        w.commit()
    except BaseException:
        w.abort()
        raise
    f = StoredFile(owner_id=p.id, name=name, folder=clean_folder(folder), storage_key=key, size=size, content_type=ctype, sha256=digest.hexdigest(),
                   ref_type=(ref_type or None) and re.sub(r"[^a-z_]", "", ref_type.lower())[:40] or None, ref_id=(ref_id or None) and str(ref_id)[:40])
    db.add(f)
    try:
        db.flush()
    except Exception:
        get_storage().delete(key)
        raise
    log(db, f.id, "uploaded", p.id, client, f"{name} · {size} bytes · {ctype}")
    return f


def _visible(p: Principal):
    """Files the person may open: their own, those shared with them, their role, or everyone."""
    shared = select(FileShare.file_id).where(or_(FileShare.user_id == p.id, FileShare.role_key == p.role, FileShare.everyone.is_(True)))
    return or_(StoredFile.owner_id == p.id, StoredFile.id.in_(shared))


def get(db: Session, p: Principal, file_id: str, write: bool = False) -> StoredFile:
    try:
        fid = uuid.UUID(str(file_id))
    except ValueError as e:
        raise NOT_FOUND from e
    q = select(StoredFile).where(StoredFile.id == fid, StoredFile.deleted_at.is_(None))
    if not p.can(MANAGE):
        q = q.where(StoredFile.owner_id == p.id) if write else q.where(_visible(p))  # only the owner changes a file; a file you may not see does not exist for you
    f = db.scalar(q)
    if f is None:
        raise NOT_FOUND
    return f


def listing(db: Session, p: Principal, scope: str, folder: str | None, ref_type: str | None, ref_id: str | None, q: str | None, limit: int, offset: int) -> dict:
    cond = [StoredFile.deleted_at.is_(None)]
    if scope == "all" and p.can(MANAGE):
        pass
    elif scope == "shared":
        cond += [_visible(p), StoredFile.owner_id != p.id]
    else:
        cond.append(StoredFile.owner_id == p.id)
    if folder is not None:
        cond.append(StoredFile.folder == clean_folder(folder))
    if ref_type:
        cond += [StoredFile.ref_type == ref_type, *([StoredFile.ref_id == ref_id] if ref_id else [])]
    if q and q.strip():
        cond.append(StoredFile.name.ilike("%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"))
    total = db.scalar(select(func.count()).select_from(StoredFile).where(*cond))
    rows = db.scalars(select(StoredFile).where(*cond).order_by(StoredFile.created_at.desc()).limit(limit).offset(offset))
    return {"files": [view(f, p) for f in rows], "total": total, "quota": quota(db, p.id)}


def rename(db: Session, p: Principal, file_id: str, name: str | None, folder: str | None, client: Client) -> StoredFile:
    f = get(db, p, file_id, write=True)
    if name is not None:
        new = clean_name(name)
        if filetypes.extension(new) not in filetypes.ALLOWED.get(f.content_type, ()):
            raise ApiError(422, f"Keep the ending .{filetypes.ALLOWED[f.content_type][0]}: the name must match what the file is.", "invalid_request")
        f.name = new
    if folder is not None:
        f.folder = clean_folder(folder)
    f.updated_at = func.now()
    log(db, f.id, "renamed", p.id, client, f"{f.folder}/{f.name}")
    db.flush()
    db.refresh(f)
    return f


def remove(db: Session, p: Principal, file_id: str, client: Client):
    f = get(db, p, file_id, write=True)
    f.deleted_at = func.now()  # the bytes are removed later by the clean-up job, so a mistake can still be undone by an administrator
    log(db, f.id, "deleted", p.id, client)


def share(db: Session, p: Principal, file_id: str, user_ids: list[int], role_key: str | None, everyone: bool, client: Client) -> list[dict]:
    f = get(db, p, file_id, write=True)
    db.execute(text(f"delete from {SCHEMA}.file_shares where file_id = :f"), {"f": f.id})  # noqa: S608  the new list replaces the old one
    ids = sorted({int(u) for u in user_ids if int(u) != f.owner_id})[:200]
    if ids and {r[0] for r in db.execute(text("select id from public.users where id = any(:u) and active"), {"u": ids})} != set(ids):
        raise ApiError(422, "One of the people chosen does not exist or is not active.", "invalid_request")
    if role_key and not db.execute(text("select 1 from public.roles where key = :k and active"), {"k": role_key}).first():
        raise ApiError(422, "Unknown role.", "invalid_request")
    for u in ids:
        db.add(FileShare(file_id=f.id, user_id=u, created_by=p.id))
    if role_key:
        db.add(FileShare(file_id=f.id, role_key=role_key, created_by=p.id))
    if everyone:
        db.add(FileShare(file_id=f.id, everyone=True, created_by=p.id))
    log(db, f.id, "shared", p.id, client, f"people {ids} role {role_key or '-'} everyone {everyone}")
    db.flush()
    return shares(db, f.id)


def shares(db: Session, file_id) -> list[dict]:
    rows = db.execute(text(f"select s.user_id, u.name as user_name, s.role_key, s.everyone from {SCHEMA}.file_shares s left join public.users u on u.id = s.user_id where s.file_id = :f order by s.id"), {"f": file_id}).mappings().all()  # noqa: S608
    return [dict(r) for r in rows]


# ---- time-limited links ----
def _key() -> bytes:
    return hashlib.sha256(b"file-link:" + get_settings().auth_secret.encode()).digest()  # a key of its own, derived from the server secret


def make_link(db: Session, p: Principal, file_id: str, seconds: int, client: Client) -> dict:
    f = get(db, p, file_id)
    seconds = max(60, min(int(seconds), get_settings().file_link_max_seconds))
    exp = int(time.time()) + seconds
    body = f"{f.id}.{exp}"
    sig = base64.urlsafe_b64encode(hmac.new(_key(), body.encode(), hashlib.sha256).digest()).decode().rstrip("=")
    log(db, f.id, "link_made", p.id, client, f"valid {seconds} s")
    return {"path": f"/api/v1/files/signed/{body}.{sig}", "expires_in": seconds}


def open_link(db: Session, token: str, client: Client) -> StoredFile:
    try:
        fid, exp, sig = token.rsplit(".", 2)
        want = base64.urlsafe_b64encode(hmac.new(_key(), f"{fid}.{exp}".encode(), hashlib.sha256).digest()).decode().rstrip("=")
        ok = hmac.compare_digest(want, sig) and int(exp) >= time.time()
        key = uuid.UUID(fid)
    except ValueError as e:
        raise NOT_FOUND from e
    f = db.scalar(select(StoredFile).where(StoredFile.id == key, StoredFile.deleted_at.is_(None))) if ok else None
    if f is None:
        raise NOT_FOUND  # wrong signature, expired, or the file was deleted since: all the same answer
    log(db, f.id, "downloaded", None, client, "signed link")
    return f


def usage(db: Session) -> dict:
    rows = db.execute(text(f"""
        select u.id, u.code, u.name, count(f.id) as files, coalesce(sum(f.size), 0) as bytes, coalesce(q.bytes, :d) as limit_bytes
          from public.users u join {SCHEMA}.files f on f.owner_id = u.id and f.deleted_at is null left join {SCHEMA}.user_quotas q on q.user_id = u.id
         group by u.id, q.bytes order by bytes desc limit 200"""), {"d": get_settings().file_quota_bytes}).mappings().all()  # noqa: S608
    tot = db.execute(text(f"select count(*) filter (where deleted_at is null) as files, coalesce(sum(size) filter (where deleted_at is null), 0) as bytes, "  # noqa: S608
                          f"coalesce(sum(size) filter (where deleted_at is not null and purged_at is null), 0) as waiting_purge from {SCHEMA}.files")).mappings().first()
    by_type = db.execute(text(f"select content_type, count(*) as files, sum(size) as bytes from {SCHEMA}.files where deleted_at is null group by 1 order by 3 desc")).mappings().all()  # noqa: S608
    return {"total": dict(tot), "by_type": [dict(r) for r in by_type], "people": [dict(r) for r in rows], "default_quota_bytes": get_settings().file_quota_bytes}


def purge_deleted(db: Session, older_than_days: int = 7) -> int:
    """Removes the bytes of files deleted some days ago. Run by the scheduler."""
    rows = db.scalars(select(StoredFile).where(StoredFile.deleted_at.is_not(None), StoredFile.purged_at.is_(None), StoredFile.deleted_at < func.now() - text(f"interval '{int(older_than_days)} days'")).limit(500)).all()
    for f in rows:
        get_storage().delete(f.storage_key)
        f.purged_at = func.now()
        log(db, f.id, "purged", None)
    return len(rows)
