from dataclasses import dataclass, field

from fastapi import Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from .config import get_settings
from .db import SCHEMA, get_db
from .errors import ApiError
from .security import read_token

COOKIE = "sfa_session"  # the web app's cookie; the platform reads it so a browser needs no second login
SUPER_LEVEL = 5


@dataclass
class Client:
    ip: str | None
    user_agent: str | None


@dataclass
class Principal:
    id: int
    code: str
    name: str
    role: str
    role_name: str
    level: int
    permissions: list[str] = field(default_factory=list)
    must_change_password: bool = False
    region_id: int | None = None
    area_id: int | None = None
    email: str | None = None
    session_id: str | None = None  # None for a token issued by the web app's own login

    @property
    def is_super(self) -> bool:
        return self.level >= SUPER_LEVEL

    def can(self, perm: str) -> bool:
        return perm in self.permissions

    def public(self) -> dict:
        return {"id": self.id, "code": self.code, "name": self.name, "role": self.role, "role_name": self.role_name, "level": self.level,
                "permissions": self.permissions, "must_change_password": self.must_change_password, "region_id": self.region_id, "area_id": self.area_id}


def client_info(request: Request) -> Client:
    ip = request.client.host if request.client else None
    if get_settings().trusted_proxy:
        # The last entry is the one our own reverse proxy added; earlier ones can be made up by the caller.
        fwd = [p.strip() for p in request.headers.get("x-forwarded-for", "").split(",") if p.strip()]
        ip = fwd[-1] if fwd else ip
    return Client(ip=(ip or None), user_agent=(request.headers.get("user-agent") or "")[:300] or None)


def bearer(request: Request) -> tuple[str | None, bool]:
    """The token and whether it came from a cookie (cookie requests need the CSRF check)."""
    h = request.headers.get("authorization", "")
    if h.lower().startswith("bearer "):
        return h[7:].strip(), False
    c = request.cookies.get(COOKIE)
    return (c, True) if c else (None, False)


_USER_SQL = text("""
    select u.id, u.code, u.name, u.email, u.region_id, u.area_id, u.must_change_password, u.token_version,
           r.key as role, r.name as role_name, r.level, r.permissions
      from public.users u join public.roles r on r.id = u.role_id
     where u.id = :id and u.active and r.active""")


def load_principal(db: Session, token: str | None) -> Principal | None:
    claims = read_token(token) if token else None
    if not claims or "uid" not in claims:
        return None
    row = db.execute(_USER_SQL, {"id": claims["uid"]}).mappings().first()
    if not row or row["token_version"] != int(claims.get("tv") or 0):
        return None
    sid = claims.get("sid")
    if sid:
        ok = db.execute(text(f"select 1 from {SCHEMA}.sessions where id = :sid and user_id = :uid and revoked_at is null and expires_at > now()"),  # noqa: S608
                        {"sid": sid, "uid": row["id"]}).first()
        if not ok:
            return None
    return Principal(id=row["id"], code=row["code"], name=row["name"], role=row["role"], role_name=row["role_name"], level=row["level"],
                     permissions=list(row["permissions"] or []), must_change_password=row["must_change_password"], region_id=row["region_id"],
                     area_id=row["area_id"], email=row["email"], session_id=sid)


def check_origin(request: Request):
    """A browser sends the cookie by itself, so a changing request must come from our own pages (or an allowed origin)."""
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    origin = request.headers.get("origin")
    if not origin:
        return  # not a browser (the mobile app, server-to-server); those use the Authorization header
    host = request.headers.get("x-forwarded-host") or request.headers.get("host") or ""
    allowed = {f"http://{host}", f"https://{host}", *get_settings().origins}
    if origin.rstrip("/") not in allowed:
        raise ApiError(403, "Request blocked: it did not come from this site.", "bad_origin")


def current(allow_temporary_password: bool = False):
    def dep(request: Request, db: Session = Depends(get_db)) -> Principal:
        token, from_cookie = bearer(request)
        if from_cookie:
            check_origin(request)
        p = load_principal(db, token)
        if not p:
            raise ApiError(401, "Please log in again.", "unauthenticated")
        if p.must_change_password and not allow_temporary_password:
            raise ApiError(403, "Change your temporary password first.", "password_change_required")
        return p
    return dep


def require(*perms: str):
    """Any one of the permissions is enough. Checked on the server for every call; the screens only hide what this refuses."""
    def dep(p: Principal = Depends(current())) -> Principal:
        if perms and not any(p.can(x) for x in perms):
            raise ApiError(403, "Your role does not allow this.", "forbidden")
        return p
    return dep


def super_admin(p: Principal = Depends(current())) -> Principal:
    if not p.is_super:
        raise ApiError(403, "Only the Super Admin can do this.", "forbidden")
    return p
