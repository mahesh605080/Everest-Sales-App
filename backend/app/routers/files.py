from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Client, Principal, client_info, current, super_admin
from ..errors import ApiError
from ..models.files import FileEvent, StoredFile, UserQuota
from ..services import files as svc
from ..services import filetypes
from ..services.storage import chunks, get_storage

router = APIRouter(tags=["files"])


def _send(f: StoredFile, inline: bool) -> StreamingResponse:
    try:
        fh = get_storage().open(f.storage_key)
    except (FileNotFoundError, KeyError) as e:
        raise ApiError(404, "This file's content is no longer in storage.", "not_found") from e
    show = inline and f.content_type in filetypes.INLINE
    return StreamingResponse(chunks(fh), media_type=f.content_type, headers={
        "content-length": str(f.size), "content-disposition": f"{'inline' if show else 'attachment'}; filename*=UTF-8''{quote(f.name)}",
        "x-content-type-options": "nosniff", "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; sandbox"})


@router.post("/files", status_code=201, summary="Upload one file (multipart form field 'file'). Private to the uploader until shared.")
async def upload(file: UploadFile = File(...), folder: str | None = Form(None), ref_type: str | None = Form(None), ref_id: str | None = Form(None),
                 p: Principal = Depends(current()), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    return svc.view(await svc.store(db, p, file, folder, ref_type, ref_id, client), p)


@router.get("/files", summary="scope = mine (default) | shared | all (needs files.manage)")
def listing(p: Principal = Depends(current()), db: Session = Depends(get_db), scope: str = Query("mine", pattern="^(mine|shared|all)$"), folder: str | None = Query(None, max_length=120),
            ref_type: str | None = Query(None, max_length=40), ref_id: str | None = Query(None, max_length=40), q: str | None = Query(None, max_length=100),
            limit: int = Query(50, ge=1, le=200), offset: int = Query(0, ge=0, le=100000)):
    return svc.listing(db, p, scope, folder, ref_type, ref_id, q, limit, offset)


@router.get("/files/signed/{token}", summary="Download through a time-limited link. No login needed; the link is the permission.")
def signed(token: str, db: Session = Depends(get_db), client: Client = Depends(client_info)):
    return _send(svc.open_link(db, token, client), inline=False)


@router.get("/files/{file_id}")
def meta(file_id: str, p: Principal = Depends(current()), db: Session = Depends(get_db)):
    f = svc.get(db, p, file_id)
    return {**svc.view(f, p), "sha256": f.sha256, "shares": svc.shares(db, f.id) if f.owner_id == p.id or p.can(svc.MANAGE) else None}


@router.get("/files/{file_id}/download")
def download(file_id: str, inline: bool = False, p: Principal = Depends(current()), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    f = svc.get(db, p, file_id)
    svc.log(db, f.id, "downloaded", p.id, client)
    db.commit()
    return _send(f, inline)


class RenameIn(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=200)
    folder: str | None = Field(None, max_length=120)


@router.patch("/files/{file_id}", summary="Rename or move to another folder (owner only)")
def rename(file_id: str, body: RenameIn, p: Principal = Depends(current()), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    return svc.view(svc.rename(db, p, file_id, body.name, body.folder, client), p)


@router.delete("/files/{file_id}")
def delete(file_id: str, p: Principal = Depends(current()), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    svc.remove(db, p, file_id, client)
    return {"ok": True}


class ShareIn(BaseModel):
    user_ids: list[int] = Field(default_factory=list, max_length=200)
    role_key: str | None = Field(None, max_length=40)
    everyone: bool = False


@router.put("/files/{file_id}/shares", summary="Set who else may open the file. The list replaces the previous one; an empty list makes it private again.")
def share(file_id: str, body: ShareIn, p: Principal = Depends(current()), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    return {"shares": svc.share(db, p, file_id, body.user_ids, body.role_key, body.everyone, client)}


class LinkIn(BaseModel):
    seconds: int = Field(600, ge=60, le=86400)


@router.post("/files/{file_id}/link", summary="A download link that works without login until it expires")
def link(file_id: str, body: LinkIn, p: Principal = Depends(current()), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    return svc.make_link(db, p, file_id, body.seconds, client)


@router.get("/files/{file_id}/history")
def history(file_id: str, p: Principal = Depends(current()), db: Session = Depends(get_db)):
    f = svc.get(db, p, file_id, write=True)
    rows = db.query(FileEvent).filter(FileEvent.file_id == f.id).order_by(FileEvent.id.desc()).limit(200).all()
    return {"events": [{"action": e.action, "user_id": e.user_id, "detail": e.detail, "ip": e.ip, "at": e.at} for e in rows]}


@router.get("/admin/files/usage", summary="Storage used: in total, by type and per person")
def usage(_: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    return svc.usage(db)


class QuotaIn(BaseModel):
    bytes: int = Field(ge=0, le=50 * 1024 ** 3)


@router.put("/admin/files/quota/{user_id}", summary="Give one person a different storage allowance")
def set_quota(user_id: int, body: QuotaIn, actor: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    q = db.get(UserQuota, user_id)
    if q is None:
        db.add(UserQuota(user_id=user_id, bytes=body.bytes, updated_by=actor.id))
    else:
        q.bytes, q.updated_by = body.bytes, actor.id
    db.flush()
    return svc.quota(db, user_id)
