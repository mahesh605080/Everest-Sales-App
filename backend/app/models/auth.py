import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import SCHEMA, Base

TS = DateTime(timezone=True)
USER = "public.users.id"  # people live in the web app's table; the platform never copies them


class _T:
    __table_args__: tuple | dict = {"schema": SCHEMA}


class Device(Base):
    """One installation of the app, or one browser. An installation id is a label, never proof of who is using it."""
    __tablename__ = "devices"
    __table_args__ = (UniqueConstraint("user_id", "installation_id"), {"schema": SCHEMA})
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    installation_id: Mapped[str] = mapped_column(String(80))
    platform: Mapped[str] = mapped_column(String(12))  # web | android | ios
    model: Mapped[str | None] = mapped_column(String(120))
    app_version: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    last_seen_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(TS)


class AuthSession(Base):
    """One login. Ending it (revoked_at) stops its access tokens at once and its refresh tokens for good."""
    __tablename__ = "sessions"
    __table_args__ = (Index("sessions_user_active", "user_id", "revoked_at"), {"schema": SCHEMA})
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[int] = mapped_column(Integer)
    device_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.devices.id"))
    client: Mapped[str] = mapped_column(String(12), default="web")  # web | android | ios
    # The person's token_version when this login was made. If it has moved on (password changed, account suspended,
    # "log out everywhere" from either service) this login can no longer be refreshed.
    token_version: Mapped[int] = mapped_column(Integer, default=0)
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    last_used_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(TS)
    revoked_at: Mapped[datetime | None] = mapped_column(TS)
    revoke_reason: Mapped[str | None] = mapped_column(String(40))


class RefreshToken(Base):
    """Only a hash of the token is kept. Each is used once; using it gives the next one in the chain."""
    __tablename__ = "refresh_tokens"
    __table_args__ = {"schema": SCHEMA}
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.sessions.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    issued_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(TS)
    used_at: Mapped[datetime | None] = mapped_column(TS)


class LoginEvent(Base):
    """Security history: every login attempt and every session change, successful or not."""
    __tablename__ = "login_events"
    __table_args__ = (Index("login_events_user_at", "user_id", "at"), Index("login_events_at", "at"), {"schema": SCHEMA})
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(Integer)
    login: Mapped[str | None] = mapped_column(String(80))  # what was typed as the user name, never the password
    outcome: Mapped[str] = mapped_column(String(30))
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True))
    ip: Mapped[str | None] = mapped_column(String(64))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    detail: Mapped[str | None] = mapped_column(Text)
    at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class PasswordReset(Base):
    __tablename__ = "password_resets"
    __table_args__ = {"schema": SCHEMA}
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    channel: Mapped[str] = mapped_column(String(12))  # email | admin
    created_by: Mapped[int | None] = mapped_column(Integer)  # the administrator who issued it, if any
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(TS)
    used_at: Mapped[datetime | None] = mapped_column(TS)


class RateLimit(Base):
    """Counters for brute-force protection. In the database so they survive a restart and are shared by every process."""
    __tablename__ = "rate_limits"
    __table_args__ = {"schema": SCHEMA}
    key: Mapped[str] = mapped_column(String(160), primary_key=True)
    window_start: Mapped[datetime] = mapped_column(TS)
    count: Mapped[int] = mapped_column(Integer)
