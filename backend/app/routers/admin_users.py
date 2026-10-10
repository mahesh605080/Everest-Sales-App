"""What an administrator may do to another person's account. The rule throughout: you can only act on someone below your own level, unless you are the Super Admin."""
from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Client, Principal, client_info, require
from ..errors import ApiError
from ..models.auth import AuthSession, Device, LoginEvent
from ..services import auth as svc
from .auth import session_view

router = APIRouter(prefix="/admin", tags=["admin: accounts"])


def target(db: Session, actor: Principal, user_id: int) -> dict:
    row = db.execute(text("select u.id, u.code, u.name, u.active, r.level, r.key as role from public.users u join public.roles r on r.id = u.role_id where u.id = :id"), {"id": user_id}).mappings().first()
    if not row:
        raise ApiError(404, "This person was not found.", "not_found")
    if not actor.is_super and (row["level"] >= actor.level or row["id"] == actor.id):
        raise ApiError(403, "You can manage only people below your own level.", "forbidden")
    return dict(row)


@router.get("/users/{user_id}/sessions")
def user_sessions(user_id: int, actor: Principal = Depends(require("employees.edit")), db: Session = Depends(get_db)):
    target(db, actor, user_id)
    rows = db.execute(select(AuthSession, Device).outerjoin(Device, Device.id == AuthSession.device_id).where(AuthSession.user_id == user_id).order_by(AuthSession.created_at.desc()).limit(50)).all()
    return {"sessions": [session_view(s, d) for s, d in rows]}


@router.post("/users/{user_id}/logout-all", summary="Sign the person out everywhere")
def force_logout(user_id: int, actor: Principal = Depends(require("employees.edit")), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    target(db, actor, user_id)
    svc.bump_token_version(db, user_id)
    n = svc.end_all(db, user_id, "ended_by_admin", client)
    audit(db, actor, "force-logout", user_id, client)
    return {"ok": True, "sessions_ended": n}


@router.post("/users/{user_id}/suspend", summary="Stop the account from being used; nothing is deleted")
def suspend(user_id: int, actor: Principal = Depends(require("employees.edit")), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    t = target(db, actor, user_id)
    if t["id"] == actor.id:
        raise ApiError(422, "You cannot suspend your own account.", "invalid_request")
    db.execute(text("update public.users set active = false, updated_at = now(), updated_by = :by where id = :id"), {"id": user_id, "by": actor.id})
    svc.bump_token_version(db, user_id)
    svc.end_all(db, user_id, "suspended", client)
    audit(db, actor, "suspend", user_id, client)
    return {"ok": True}


@router.post("/users/{user_id}/activate")
def activate(user_id: int, actor: Principal = Depends(require("employees.edit")), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    target(db, actor, user_id)
    db.execute(text("update public.users set active = true, failed_logins = 0, locked_until = null, updated_at = now(), updated_by = :by where id = :id"), {"id": user_id, "by": actor.id})
    audit(db, actor, "activate", user_id, client)
    return {"ok": True}


@router.post("/users/{user_id}/reset-code", summary="A one-time code the person uses to set a new password. Shown once; pass it on by phone.")
def reset_code(user_id: int, actor: Principal = Depends(require("employees.edit")), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    t = target(db, actor, user_id)
    if not t["active"]:
        raise ApiError(422, "Activate the account first.", "invalid_request")
    out = svc.admin_reset_code(db, actor, user_id, client)
    audit(db, actor, "reset-code-issued", user_id, client)
    return {**out, "login": t["code"]}


@router.get("/login-events", summary="Security history: logins, refusals, resets, forced logouts")
def login_events(actor: Principal = Depends(require("audit.view")), db: Session = Depends(get_db), user_id: int | None = None, outcome: str | None = Query(None, max_length=30),
                 limit: int = Query(100, ge=1, le=500), before_id: int | None = None):
    q = select(LoginEvent).order_by(LoginEvent.id.desc()).limit(limit)
    if user_id is not None:
        q = q.where(LoginEvent.user_id == user_id)
    if outcome:
        q = q.where(LoginEvent.outcome == outcome)
    if before_id:
        q = q.where(LoginEvent.id < before_id)
    rows = db.scalars(q).all()
    return {"events": [{"id": e.id, "user_id": e.user_id, "login": e.login, "outcome": e.outcome, "ip": e.ip, "user_agent": e.user_agent, "detail": e.detail, "at": e.at,
                        "session_id": str(e.session_id) if e.session_id else None} for e in rows], "next_before_id": rows[-1].id if len(rows) == limit else None}


def audit(db: Session, actor: Principal, action: str, user_id: int, client: Client):
    """Privileged actions also go into the web app's audit log, where administrators already look."""
    db.execute(text("insert into public.audit_logs(user_id, user_name, action, entity, entity_id, ip) values (:u, :n, :a, 'users', :e, :ip)"),
               {"u": actor.id, "n": actor.name, "a": action, "e": str(user_id), "ip": client.ip})
