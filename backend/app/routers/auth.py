import uuid
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..deps import Client, Principal, client_info, current, load_principal
from ..errors import ApiError
from ..models.auth import AuthSession, Device
from ..services import auth as svc

router = APIRouter(prefix="/auth", tags=["auth"])


class DeviceIn(BaseModel):
    installation_id: str = Field(min_length=8, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    platform: Literal["web", "android", "ios"]
    model: str | None = Field(None, max_length=120)
    app_version: str | None = Field(None, max_length=40)


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=80)
    password: str = Field(min_length=1, max_length=200)
    device: DeviceIn | None = None


class RefreshIn(BaseModel):
    refresh_token: str = Field(min_length=20, max_length=200)


class PasswordIn(BaseModel):
    current: str = Field(min_length=1, max_length=200)
    next: str = Field(min_length=1, max_length=200)


class ResetRequestIn(BaseModel):
    login: str = Field(min_length=1, max_length=80)


class ResetConfirmIn(BaseModel):
    login: str = Field(min_length=1, max_length=80)
    token: str = Field(min_length=8, max_length=120)
    new_password: str = Field(min_length=1, max_length=200)


@router.post("/login", summary="Log in; returns a short access token and a refresh token")
def login(body: LoginIn, db: Session = Depends(get_db), client: Client = Depends(client_info)):
    out = svc.login(db, body.login, body.password, client, body.device.model_dump() if body.device else None)
    db.flush()
    p = load_principal(db, out["access_token"])
    return {**out, "user": p.public() if p else None}


@router.post("/refresh", summary="Exchange a refresh token for a new access token and a new refresh token")
def refresh(body: RefreshIn, db: Session = Depends(get_db), client: Client = Depends(client_info)):
    return svc.refresh(db, body.refresh_token, client)


@router.get("/me", summary="The person behind the token, with role and permissions")
def me(p: Principal = Depends(current(allow_temporary_password=True))):
    return {"user": p.public(), "session_id": p.session_id}


@router.post("/logout", summary="End this login only")
def logout(p: Principal = Depends(current(allow_temporary_password=True)), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    if p.session_id:
        svc.end_session(db, p.session_id, "logout", client, user_id=p.id)
    return {"ok": True}


@router.post("/logout-all", summary="End every login of this person, on every device")
def logout_all(p: Principal = Depends(current(allow_temporary_password=True)), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    svc.bump_token_version(db, p.id)
    return {"ok": True, "sessions_ended": svc.end_all(db, p.id, "logout_all", client)}


@router.get("/sessions", summary="Where this person is logged in")
def sessions(p: Principal = Depends(current()), db: Session = Depends(get_db)):
    rows = db.execute(select(AuthSession, Device).outerjoin(Device, Device.id == AuthSession.device_id)
                      .where(AuthSession.user_id == p.id, AuthSession.revoked_at.is_(None), AuthSession.expires_at > svc.now()).order_by(AuthSession.last_used_at.desc())).all()
    return {"sessions": [session_view(s, d, p.session_id) for s, d in rows]}


def session_view(s: AuthSession, d: Device | None, current_id: str | None = None) -> dict:
    return {"id": str(s.id), "client": s.client, "device": d.model if d else None, "app_version": d.app_version if d else None, "ip": s.ip, "user_agent": s.user_agent,
            "created_at": s.created_at, "last_used_at": s.last_used_at, "expires_at": s.expires_at, "current": str(s.id) == current_id,
            "revoked_at": s.revoked_at, "revoke_reason": s.revoke_reason}


@router.delete("/sessions/{session_id}", summary="End one of this person's other logins")
def end_one(session_id: str, p: Principal = Depends(current()), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    try:
        sid = uuid.UUID(session_id)
    except ValueError as e:
        raise ApiError(404, "This login was not found.", "not_found") from e
    ok = svc.end_session(db, sid, "ended_by_user", client, user_id=p.id)
    if not ok:
        raise ApiError(404, "This login was not found.", "not_found")
    return {"ok": True}


@router.post("/password", summary="Change own password; every other device is logged out")
def password(body: PasswordIn, p: Principal = Depends(current(allow_temporary_password=True)), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    return svc.change_password(db, p, body.current, body.next, client)


@router.post("/password/reset/request", summary="Ask for a reset link by email (same answer whether or not the account exists)")
def reset_request(body: ResetRequestIn, db: Session = Depends(get_db), client: Client = Depends(client_info)):
    svc.request_reset(db, body.login, client)
    return {"ok": True, "message": "If this account has an email address, a reset link has been sent. Otherwise ask your administrator for a reset code."}


@router.post("/password/reset/confirm", summary="Set a new password with a reset link or code")
def reset_confirm(body: ResetConfirmIn, db: Session = Depends(get_db), client: Client = Depends(client_info)):
    svc.confirm_reset(db, body.login, body.token, body.new_password, client)
    return {"ok": True}
