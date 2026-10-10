import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import SCHEMA, Base

TS = DateTime(timezone=True)


class Collection(Base):
    """A named set of documents with declared fields. This is the flexible store; business records stay in their own tables."""
    __tablename__ = "collections"
    __table_args__ = {"schema": SCHEMA}
    name: Mapped[str] = mapped_column(String(40), primary_key=True)
    label: Mapped[str] = mapped_column(String(120))
    fields: Mapped[list] = mapped_column(JSONB)  # [{name, type, required, max, options}]
    read_rule: Mapped[str] = mapped_column(String(80), default="owner")   # owner | authenticated | <permission>
    write_rule: Mapped[str] = mapped_column(String(80), default="owner")  # owner | <permission>
    max_docs_per_user: Mapped[int] = mapped_column(Integer, default=1000)
    max_doc_bytes: Mapped[int] = mapped_column(Integer, default=16384)
    audited: Mapped[bool] = mapped_column(Boolean, default=False)
    realtime: Mapped[bool] = mapped_column(Boolean, default=False)  # publish changes to subscribers (Phase 4)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    created_by: Mapped[int | None] = mapped_column(Integer)


class Document(Base):
    __tablename__ = "documents"
    __table_args__ = (
        Index("documents_collection_owner", "collection", "owner_id", "created_at"),
        Index("documents_data_gin", "data", postgresql_using="gin", postgresql_ops={"data": "jsonb_path_ops"}),
        {"schema": SCHEMA},
    )
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    collection: Mapped[str] = mapped_column(String(40), ForeignKey(f"{SCHEMA}.collections.name"))
    owner_id: Mapped[int] = mapped_column(Integer)
    data: Mapped[dict] = mapped_column(JSONB)
    version: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_by: Mapped[int | None] = mapped_column(Integer)
    deleted_at: Mapped[datetime | None] = mapped_column(TS)
