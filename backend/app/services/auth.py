"""Logging in, staying logged in and logging out. The people and their passwords are the web app's `users` table."""
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..deps import Client, Principal
from ..errors import ApiError
from ..models.auth import AuthSession, Device, LoginEvent, PasswordReset, RefreshToken
from ..security import digest, hash_password, make_access_token, needs_upgrade, new_code, new_token, normalise_code, verify_password
from . import mail, ratelimit

WRONG = ApiError(401, "Employee code or password is wrong.", "wrong_credentials")
now = lambda: datetime.now(UTC)  # noqa: E731


def record(db: Session, outcome: str, client: Client, user_id: int | None = None, login: str | None = None, session_id=None, detail: str | None = None):
    db.add(LoginEvent(user_id=user_id, login=(login or "")[:80] or None, outcome=outcome, session_id=session_id, ip=client.ip, user_agent=client.user_agent, detail=detail))


def _find_user(db: Session, login: str):
    return db.execute(text("""select u.id, u.code, u.password_hash, u.active, u.token_version, u.failed_logins, u.locked_until, u.email, r.active as role_active
                                from public.users u join public.roles r on r.id = u.role_id where upper(u.code) = upper(:l) or u.phone = :l"""), {"l": login}).mappings().first()


def _issue_refresh(db: Session, session: AuthSession) -> str:
    raw = new_token()
    db.add(RefreshToken(session_id=session.id, token_hash=digest(raw), expires_at=session.expires_at))
    return raw


def _tokens(db: Session, user_id: int, token_version: int, session: AuthSession) -> dict:
    access, ttl = make_access_token(user_id, token_version, str(session.id))
    return {"access_token": access, "token_type": "Bearer", "expires_in": ttl, "refresh_token": _issue_refresh(db, session), "session_id": str(session.id)}


def _device(db: Session, user_id: int, info: dict | None) -> Device | None:
    if not info or not info.get("installation_id"):
        return None
    d = db.scalar(select(Device).where(Device.user_id == user_id, Device.installation_id == info["installation_id"]))
    if d is None:
        d = Device(user_id=user_id, installation_id=info["installation_id"], platform=info.get("platform") or "web")
        db.add(d)
    d.platform, d.model, d.app_version, d.last_seen_at, d.revoked_at = info.get("platform") or d.platform, info.get("model"), info.get("app_version"), now(), None
    db.flush()
    return d


def login(db: Session, login_name: str, password: str, client: Client, device: dict | None) -> dict:
    s = get_settings()
    ip_key, window = f"login-ip:{client.ip}", s.login_lock_minutes * 60
    if client.ip and ratelimit.count(db, ip_key, window) >= s.login_max_per_ip:
        record(db, "rate_limited", client, login=login_name)
        db.commit()
        raise ApiError(429, f"Too many wrong logins from this network. Wait {s.login_lock_minutes} minutes and try again.", "rate_limited")
    u = _find_user(db, login_name.strip())

    def fail(outcome: str, user_id: int | None = None, err: ApiError = WRONG):
        if client.ip:
            ratelimit.hit(db, ip_key, window)
        record(db, outcome, client, user_id=user_id, login=login_name)
        db.commit()  # the failure must be remembered even though the request ends in an error
        raise err

    if not u:
        verify_password(password, "$argon2id$v=19$m=65536,t=3,p=4$c29tZXNhbHRzb21lc2FsdA$8mYq8mPz0C1o1nq3lqL8pJ3m0e1C2Yb9s0s1t2u3v4w")  # same work as a real check, so timing does not reveal the account
        fail("unknown_user")
    if not u["active"] or not u["role_active"]:
        fail("inactive", u["id"])
    if u["locked_until"] and u["locked_until"] > now():
        fail("locked", u["id"], ApiError(423, f"Too many wrong attempts. Try again after {s.login_lock_minutes} minutes or ask Admin to reset your password.", "locked"))
    if not verify_password(password, u["password_hash"]):
        fails = u["failed_logins"] + 1
        lock = fails >= s.login_max_fails
        db.execute(text("update public.users set failed_logins = :f, locked_until = :l where id = :id"),
                   {"f": 0 if lock else fails, "l": now() + timedelta(minutes=s.login_lock_minutes) if lock else None, "id": u["id"]})
        fail("locked_out" if lock else "wrong_password", u["id"])

    upgraded = needs_upgrade(u["password_hash"])
    db.execute(text("update public.users set failed_logins = 0, locked_until = null, last_login_at = now(), password_hash = coalesce(:h, password_hash) where id = :id"),
               {"id": u["id"], "h": hash_password(password) if upgraded else None})
    dev = _device(db, u["id"], device)
    sess = AuthSession(user_id=u["id"], token_version=u["token_version"], device_id=dev.id if dev else None, client=(device or {}).get("platform") or "web", ip=client.ip, user_agent=client.user_agent,
                       expires_at=now() + timedelta(days=s.refresh_token_days))
    db.add(sess)
    db.flush()
    record(db, "success", client, user_id=u["id"], login=login_name, session_id=sess.id, detail="password hash upgraded to Argon2id" if upgraded else None)
    return _tokens(db, u["id"], u["token_version"], sess)


def refresh(db: Session, raw: str, client: Client) -> dict:
    s = get_settings()
    bad = ApiError(401, "Please log in again.", "invalid_refresh")
    rt = db.scalar(select(RefreshToken).where(RefreshToken.token_hash == digest(raw)).with_for_update())
    if rt is None:
        raise bad
    sess = db.get(AuthSession, rt.session_id, with_for_update=True)
    if sess is None or sess.revoked_at is not None or rt.expires_at <= now() or sess.expires_at <= now():
        raise bad
    if rt.used_at is not None and (now() - rt.used_at).total_seconds() > s.refresh_grace_seconds:
        # A refresh token is shown to us a second time, long after it was used: somebody has a copy. End the whole login.
        sess.revoked_at, sess.revoke_reason = now(), "refresh_reuse"
        record(db, "refresh_reuse", client, user_id=sess.user_id, session_id=sess.id)
        db.commit()
        raise bad
    u = db.execute(text("select u.id, u.token_version from public.users u join public.roles r on r.id = u.role_id where u.id = :id and u.active and r.active"), {"id": sess.user_id}).mappings().first()
    if not u or u["token_version"] != sess.token_version:
        sess.revoked_at, sess.revoke_reason = now(), "account_inactive" if not u else "signed_out_everywhere"
        db.commit()
        raise bad
    if rt.used_at is None:
        rt.used_at = now()
    sess.last_used_at, sess.ip = now(), client.ip or sess.ip
    if sess.device_id:
        db.execute(update(Device).where(Device.id == sess.device_id).values(last_seen_at=now()))
    return _tokens(db, u["id"], u["token_version"], sess)


def end_session(db: Session, session_id, reason: str, client: Client, user_id: int | None = None) -> bool:
    q = update(AuthSession).where(AuthSession.id == session_id, AuthSession.revoked_at.is_(None)).values(revoked_at=now(), revoke_reason=reason)
    if user_id is not None:
        q = q.where(AuthSession.user_id == user_id)
    done = db.execute(q.returning(AuthSession.user_id)).first()
    if done:
        record(db, reason, client, user_id=done[0], session_id=session_id)
    return bool(done)


def end_all(db: Session, user_id: int, reason: str, client: Client, keep=None) -> int:
    """Ends every login of the person. `token_version` also stops tokens issued by the web app's own login."""
    q = update(AuthSession).where(AuthSession.user_id == user_id, AuthSession.revoked_at.is_(None)).values(revoked_at=now(), revoke_reason=reason)
    if keep is not None:
        q = q.where(AuthSession.id != keep)
    n = len(db.execute(q.returning(AuthSession.id)).all())
    record(db, reason, client, user_id=user_id, detail=f"{n} sessions ended")
    return n


def bump_token_version(db: Session, user_id: int) -> int:
    return int(db.execute(text("update public.users set token_version = token_version + 1, updated_at = now() where id = :id returning token_version"), {"id": user_id}).scalar_one())


def check_new_password(new: str, current_hash: str | None = None):
    if len(new) < 8:
        raise ApiError(422, "The new password must be at least 8 characters.", "weak_password")
    if len(new) > 200:
        raise ApiError(422, "The new password is too long.", "weak_password")
    if current_hash and verify_password(new, current_hash):
        raise ApiError(422, "The new password must be different from the current one.", "weak_password")


def change_password(db: Session, p: Principal, current: str, new: str, client: Client) -> dict:
    row = db.execute(text("select password_hash from public.users where id = :id for update"), {"id": p.id}).first()
    if not row or not verify_password(current, row[0]):
        record(db, "password_change_refused", client, user_id=p.id, session_id=p.session_id)
        db.commit()
        raise ApiError(401, "Current password is wrong.", "wrong_credentials")
    check_new_password(new, row[0])
    db.execute(text("update public.users set password_hash = :h, must_change_password = false, updated_at = now() where id = :id"), {"h": hash_password(new), "id": p.id})
    tv = bump_token_version(db, p.id)  # every other device is signed out
    ended = end_all(db, p.id, "password_changed", client, keep=p.session_id)
    out: dict = {"ok": True, "other_sessions_ended": ended}
    if p.session_id:  # this device stays logged in with a token for the new version
        db.execute(update(AuthSession).where(AuthSession.id == p.session_id).values(token_version=tv))
        access, ttl = make_access_token(p.id, tv, p.session_id)
        out.update(access_token=access, expires_in=ttl)
    return out


def _new_reset(db: Session, user_id: int, channel: str, created_by: int | None, long_token: bool) -> str:
    db.execute(update(PasswordReset).where(PasswordReset.user_id == user_id, PasswordReset.used_at.is_(None)).values(used_at=now()))  # an older unused one stops working
    raw = new_token(32) if long_token else new_code()
    db.add(PasswordReset(user_id=user_id, token_hash=digest(raw), channel=channel, created_by=created_by, expires_at=now() + timedelta(minutes=get_settings().reset_minutes)))
    return raw


def request_reset(db: Session, login_name: str, client: Client) -> None:
    """Always answers the same way, so nobody can find out which codes or numbers exist."""
    s = get_settings()
    ratelimit.limit(db, f"reset-ip:{client.ip}", 5, 3600, "Too many reset requests. Try again in an hour.")
    u = _find_user(db, login_name.strip())
    if u and u["active"] and u["email"] and mail.configured():
        raw = _new_reset(db, u["id"], "email", None, long_token=True)
        link = f"{s.public_url.rstrip('/')}/login?reset={raw}&login={u['code']}" if s.public_url else None
        mail.send(u["email"], "Everest Sales: reset your password",
                  f"A password reset was asked for your account {u['code']}.\n\n" + (f"Open this link within {s.reset_minutes} minutes:\n{link}\n\n" if link else f"Reset code (valid {s.reset_minutes} minutes): {raw}\n\n") +
                  "If you did not ask for it, ignore this message; your password stays as it is.")
        record(db, "reset_requested", client, user_id=u["id"], login=login_name, detail="email")
    else:
        record(db, "reset_requested", client, user_id=u["id"] if u else None, login=login_name, detail="not sent")


def admin_reset_code(db: Session, actor: Principal, user_id: int, client: Client) -> dict:
    raw = _new_reset(db, user_id, "admin", actor.id, long_token=False)
    record(db, "reset_issued", client, user_id=user_id, detail=f"by {actor.code}")
    return {"code": raw, "valid_minutes": get_settings().reset_minutes}


def confirm_reset(db: Session, login_name: str, token: str, new: str, client: Client) -> None:
    bad = ApiError(400, "This reset code is not valid or has expired. Ask for a new one.", "invalid_reset")
    ratelimit.limit(db, f"reset-try:{client.ip}:{login_name.strip().upper()}", 8, 900, "Too many wrong reset codes. Wait 15 minutes.")
    db.commit()  # keep the count even if the attempt fails
    u = _find_user(db, login_name.strip())
    if not u or not u["active"]:
        raise bad
    pr = db.scalar(select(PasswordReset).where(PasswordReset.user_id == u["id"], PasswordReset.used_at.is_(None), PasswordReset.expires_at > now(),
                                               PasswordReset.token_hash.in_([digest(token.strip()), digest(normalise_code(token))])).with_for_update())
    if pr is None:
        record(db, "reset_refused", client, user_id=u["id"], login=login_name)
        db.commit()
        raise bad
    check_new_password(new)
    pr.used_at = now()
    db.execute(text("update public.users set password_hash = :h, must_change_password = false, failed_logins = 0, locked_until = null, updated_at = now() where id = :id"), {"h": hash_password(new), "id": u["id"]})
    bump_token_version(db, u["id"])
    end_all(db, u["id"], "password_reset", client)
    record(db, "reset_done", client, user_id=u["id"], login=login_name, detail=pr.channel)
