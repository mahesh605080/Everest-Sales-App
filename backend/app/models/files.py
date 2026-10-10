import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, String, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import SCHEMA, Base

TS = DateTime(timezone=True)


class StoredFile(Base):
    """What we know about a file. The bytes are in the storage backend under `storage_key`, a random name that has nothing to do with the name the person gave."""
    __tablename__ = "files"
    __table_args__ = (Index("files_owner", "owner_id", "deleted_at"), Index("files_ref", "ref_type", "ref_id"), {"schema": SCHEMA})
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[int] = mapped_column(Integer)
    name: Mapped[str] = mapped_column(String(200))
    folder: Mapped[str] = mapped_column(String(120), default="")
    storage_key: Mapped[str] = mapped_column(String(80), unique=True)
    size: Mapped[int] = mapped_column(BigInteger)
    content_type: Mapped[str] = mapped_column(String(100))  # what the bytes are, found by looking at them
    sha256: Mapped[str] = mapped_column(String(64))
    ref_type: Mapped[str | None] = mapped_column(String(40))  # optional link to a business record, e.g. "claim"
    ref_id: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    deleted_at: Mapped[datetime | None] = mapped_column(TS)
    purged_at: Mapped[datetime | None] = mapped_column(TS)  # when the bytes were removed from storage


class FileShare(Base):
    """Who besides the owner may open a file: one person, everyone with a role, or everyone."""
    __tablename__ = "file_shares"
    __table_args__ = (UniqueConstraint("file_id", "user_id", "role_key", "everyone"), {"schema": SCHEMA})
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.files.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(Integer)
    role_key: Mapped[str | None] = mapped_column(String(40))
    everyone: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class FileEvent(Base):
    """History of a file: who uploaded, opened, renamed, shared or deleted it."""
    __tablename__ = "file_events"
    __table_args__ = (Index("file_events_file", "file_id", "at"), {"schema": SCHEMA})
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    file_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True))
    user_id: Mapped[int | None] = mapped_column(Integer)  # empty for a download through a signed link
    action: Mapped[str] = mapped_column(String(30))
    detail: Mapped[str | None] = mapped_column(String(300))
    ip: Mapped[str | None] = mapped_column(String(64))
    at: Mapped[datetime] = mapped_column(TS, server_default=func.now())


class UserQuota(Base):
    """A storage allowance for one person, where it differs from the default."""
    __tablename__ = "user_quotas"
    __table_args__ = {"schema": SCHEMA}
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    bytes: Mapped[int] = mapped_column(BigInteger)
    updated_by: Mapped[int | None] = mapped_column(Integer)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
