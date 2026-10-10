import uuid
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import SCHEMA, Base

TS = DateTime(timezone=True)


class Event(Base):
    """The event log. A row is written in the same transaction as the change it describes, so an event exists only if the change was committed.
    A database trigger announces each committed row; the realtime service forwards it to whoever is subscribed. Rows are kept for a while so a client can catch up."""
    __tablename__ = "events"
    __table_args__ = (Index("events_channel_id", "channel", "id"), UniqueConstraint("dedupe_key"), {"schema": SCHEMA})
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    channel: Mapped[str] = mapped_column(String(120))
    type: Mapped[str] = mapped_column(String(60))
    payload: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    dedupe_key: Mapped[str | None] = mapped_column(String(160))  # the same key twice is stored once
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now(), index=True)


class ChatRoom(Base):
    __tablename__ = "chat_rooms"
    __table_args__ = {"schema": SCHEMA}
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    kind: Mapped[str] = mapped_column(String(10))  # direct | group
    name: Mapped[str | None] = mapped_column(String(80))
    direct_key: Mapped[str | None] = mapped_column(String(40), unique=True)  # "lowId:highId", so two people have one direct room
    created_by: Mapped[int] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    last_message_at: Mapped[datetime | None] = mapped_column(TS)


class ChatMember(Base):
    __tablename__ = "chat_members"
    __table_args__ = (Index("chat_members_user", "user_id"), {"schema": SCHEMA})
    room_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.chat_rooms.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    joined_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    last_delivered_id: Mapped[int] = mapped_column(BigInteger, default=0)  # highest message that reached one of this person's devices
    last_read_id: Mapped[int] = mapped_column(BigInteger, default=0)


class ChatMessage(Base):
    __tablename__ = "chat_messages"
    __table_args__ = (Index("chat_messages_room_id", "room_id", "id"), UniqueConstraint("sender_id", "client_id"), {"schema": SCHEMA})
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    room_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.chat_rooms.id", ondelete="CASCADE"))
    sender_id: Mapped[int] = mapped_column(Integer)
    body: Mapped[str] = mapped_column(Text)
    client_id: Mapped[str | None] = mapped_column(String(64))  # set by the sender; a message re-sent after a lost connection is stored once
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
