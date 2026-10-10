"""Password hashing and tokens. Nothing here is ever logged."""
import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from .config import get_settings

# Argon2id with the library's current recommended cost (RFC 9106 low-memory profile: 64 MiB, 3 passes, 4 lanes).
_argon = PasswordHasher()
_ALG = "HS256"


def hash_password(plain: str) -> str:
    return _argon.hash(plain)


def verify_password(plain: str, stored: str) -> bool:
    """Accepts the Argon2id hashes written from now on and the bcrypt hashes the web app wrote before."""
    try:
        if stored.startswith("$argon2"):
            return _argon.verify(stored, plain)
        if stored.startswith("$2"):
            return bcrypt.checkpw(plain.encode()[:72], stored.encode())
    except (VerificationError, InvalidHashError, ValueError):
        return False
    return False


def needs_upgrade(stored: str) -> bool:
    return not stored.startswith("$argon2id$") or _argon.check_needs_rehash(stored)


def new_token(nbytes: int = 48) -> str:
    return secrets.token_urlsafe(nbytes)


def new_code() -> str:
    """A reset code short enough to read out over the phone: 12 characters, no look-alike letters, about 59 bits."""
    alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"
    raw = "".join(secrets.choice(alphabet) for _ in range(12))
    return f"{raw[:4]}-{raw[4:8]}-{raw[8:]}"


def digest(token: str) -> str:
    """Tokens are high-entropy random strings, so a plain SHA-256 is the right stored form (unlike passwords)."""
    return hashlib.sha256(token.encode()).hexdigest()


def normalise_code(code: str) -> str:
    c = "".join(ch for ch in code.upper() if ch.isalnum())
    return f"{c[:4]}-{c[4:8]}-{c[8:]}" if len(c) == 12 else code.strip()


def make_access_token(user_id: int, token_version: int, session_id: str) -> tuple[str, int]:
    s = get_settings()
    now = datetime.now(UTC)
    ttl = s.access_token_minutes * 60
    # "uid" and "tv" are the claims the web app already reads, so it accepts this token unchanged.
    tok = jwt.encode({"uid": user_id, "tv": token_version, "sid": session_id, "typ": "access", "iat": now, "exp": now + timedelta(seconds=ttl)}, s.auth_secret, algorithm=_ALG)
    return tok, ttl


def read_token(token: str) -> dict | None:
    try:
        return jwt.decode(token, get_settings().auth_secret, algorithms=[_ALG], options={"require": ["exp", "iat"]})
    except jwt.PyJWTError:
        return None
