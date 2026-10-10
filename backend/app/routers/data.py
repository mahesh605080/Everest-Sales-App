from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Client, Principal, client_info, current, super_admin
from ..errors import ApiError
from ..models.data import Collection
from ..services import documents as svc
from .admin_users import audit

router = APIRouter(tags=["data"])


class CollectionIn(BaseModel):
    name: str = Field(pattern=r"^[a-z][a-z0-9_]{1,39}$")
    label: str = Field(min_length=1, max_length=120)
    fields: list[dict]
    read_rule: str = "owner"
    write_rule: str = "owner"
    max_docs_per_user: int = Field(1000, ge=1, le=100000)
    max_doc_bytes: int = Field(16384, ge=256, le=262144)
    audited: bool = False
    realtime: bool = False


def collection_view(c: Collection) -> dict:
    return {"name": c.name, "label": c.label, "fields": c.fields, "read_rule": c.read_rule, "write_rule": c.write_rule, "max_docs_per_user": c.max_docs_per_user,
            "max_doc_bytes": c.max_doc_bytes, "audited": c.audited, "realtime": c.realtime, "active": c.active}


@router.get("/data", summary="The collections that exist")
def collections(_: Principal = Depends(current()), db: Session = Depends(get_db)):
    return {"collections": [collection_view(c) for c in db.scalars(select(Collection).where(Collection.active).order_by(Collection.name))]}


@router.put("/admin/collections", summary="Create a collection or change its rules and fields (Super Admin)")
def save_collection(body: CollectionIn, actor: Principal = Depends(super_admin), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    fields = svc.clean_fields(body.fields)
    c = db.get(Collection, body.name)
    if c is None:
        c = Collection(name=body.name, created_by=actor.id)
        db.add(c)
    else:
        # Existing documents were checked against the old fields. A field may be added or relaxed, never retyped, so they stay valid.
        old = {f["name"]: f for f in c.fields}
        for f in fields:
            if f["name"] in old and old[f["name"]]["type"] != f["type"]:
                raise ApiError(422, f"Field '{f['name']}' already holds {old[f['name']]['type']} values; its type cannot be changed.", "invalid_request")
            if f["name"] not in old and f["required"]:
                raise ApiError(422, f"New field '{f['name']}' cannot be required: existing documents do not have it.", "invalid_request")
    c.label, c.fields, c.read_rule, c.write_rule = body.label, fields, svc.check_rule(body.read_rule, False), svc.check_rule(body.write_rule, True)
    c.max_docs_per_user, c.max_doc_bytes, c.audited, c.realtime, c.active = body.max_docs_per_user, body.max_doc_bytes, body.audited, body.realtime, True
    db.flush()
    audit(db, actor, f"collection-saved:{c.name}", actor.id, client)
    return collection_view(c)


@router.delete("/admin/collections/{name}", summary="Switch a collection off. Its documents are kept, not erased.")
def retire_collection(name: str, actor: Principal = Depends(super_admin), db: Session = Depends(get_db)):
    c = svc.get_collection(db, name)
    c.active = False
    return {"ok": True}


@router.get("/data/{collection}", summary="List documents. Filter with f.<field>=, f.<field>.gte=, .lte=, .gt=, .lt=, .in=a,b")
def list_docs(collection: str, request: Request, p: Principal = Depends(current()), db: Session = Depends(get_db), q: str | None = Query(None, max_length=100),
              sort: str | None = Query(None, max_length=45), limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=10000), mine: bool = False):
    c = svc.get_collection(db, collection)
    filters = {k[2:]: v for k, v in request.query_params.items() if k.startswith("f.")}
    if len(filters) > 8:
        raise ApiError(422, "At most 8 filters.", "invalid_request")
    return svc.search(db, c, p, filters, q, sort, limit, offset, mine)


@router.post("/data/{collection}", status_code=201)
def create_doc(collection: str, body: dict, p: Principal = Depends(current()), db: Session = Depends(get_db)):
    return svc.view(svc.create(db, svc.get_collection(db, collection), p, body))


@router.get("/data/{collection}/{doc_id}")
def get_doc(collection: str, doc_id: str, p: Principal = Depends(current()), db: Session = Depends(get_db)):
    return svc.view(svc.fetch(db, svc.get_collection(db, collection), p, doc_id))


@router.patch("/data/{collection}/{doc_id}", summary="Change some fields. Send if_version to refuse the change if somebody else saved first.")
def patch_doc(collection: str, doc_id: str, body: dict, p: Principal = Depends(current()), db: Session = Depends(get_db), if_version: int | None = None):
    return svc.view(svc.update(db, svc.get_collection(db, collection), p, doc_id, body, if_version))


@router.delete("/data/{collection}/{doc_id}")
def delete_doc(collection: str, doc_id: str, p: Principal = Depends(current()), db: Session = Depends(get_db)):
    svc.delete(db, svc.get_collection(db, collection), p, doc_id)
    return {"ok": True}
