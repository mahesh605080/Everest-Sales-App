import uuid
from datetime import datetime, time

from sqlalchemy import BigInteger, Boolean, DateTime, ForeignKey, Index, Integer, SmallInteger, String, Text, Time, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from ..db import SCHEMA, Base

TS = DateTime(timezone=True)


class PushSubscription(Base):
    """A way to reach one device when the app or page is not open: a browser's Web Push subscription or an iPhone's APNs token.
    The keys belong to the device and are used only on the server to encrypt for it; they are never sent to any client."""
    __tablename__ = "push_subscriptions"
    __table_args__ = (Index("push_subs_user", "user_id", "active"), {"schema": SCHEMA})
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer)
    device_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.devices.id", ondelete="SET NULL"))
    # The login this registration was made under. When that login ends, for any reason, push to this device stops.
    session_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.sessions.id", ondelete="SET NULL"))
    channel: Mapped[str] = mapped_column(String(10))  # webpush | apns
    endpoint: Mapped[str] = mapped_column(Text, unique=True)  # the push service URL, or the APNs device token
    p256dh: Mapped[str | None] = mapped_column(String(200))
    auth: Mapped[str | None] = mapped_column(String(100))
    user_agent: Mapped[str | None] = mapped_column(String(300))
    app_version: Mapped[str | None] = mapped_column(String(40))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    last_success_at: Mapped[datetime | None] = mapped_column(TS)
    last_failure_at: Mapped[datetime | None] = mapped_column(TS)
    failures: Mapped[int] = mapped_column(Integer, default=0)
    active: Mapped[bool] = mapped_column(Boolean, default=True)
    revoked_reason: Mapped[str | None] = mapped_column(String(60))


class Notification(Base):
    """One thing to tell people. It fans out into a delivery row per person and channel."""
    __tablename__ = "notifications"
    __table_args__ = (Index("notifications_status_due", "status", "scheduled_at"), {"schema": SCHEMA})
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    title: Mapped[str] = mapped_column(String(150))
    body: Mapped[str | None] = mapped_column(String(500))
    category: Mapped[str] = mapped_column(String(30), default="general")
    url: Mapped[str | None] = mapped_column(String(300))   # where a tap leads, inside the app
    icon: Mapped[str | None] = mapped_column(String(300))
    data: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    audience: Mapped[dict] = mapped_column(JSONB)          # {"kind": "users"|"role"|"area"|"region"|"all", ...}
    priority: Mapped[int] = mapped_column(SmallInteger, default=5)  # 1 urgent (ignores quiet hours) .. 9 low
    status: Mapped[str] = mapped_column(String(12), default="queued")  # scheduled | queued | done | cancelled
    source: Mapped[str] = mapped_column(String(12), default="manual")   # manual | system (made by the web app's own notify)
    idempotency_key: Mapped[str | None] = mapped_column(String(120), unique=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(TS)
    expires_at: Mapped[datetime | None] = mapped_column(TS)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    fanned_out_at: Mapped[datetime | None] = mapped_column(TS)


class Delivery(Base):
    """One attempt to reach one person through one channel. The states say exactly how far it got:
    queued -> processing -> accepted (the push service took it; that is not proof the phone showed it) -> confirmed (the device told us it showed it)
    or stored (written to the in-app inbox) · skipped (opted out, throttled, no way to reach) · expired · failed (will retry) · dead (gave up)."""
    __tablename__ = "deliveries"
    __table_args__ = (UniqueConstraint("notification_id", "user_id", "channel", "subscription_id"), Index("deliveries_due", "status", "next_attempt_at"), Index("deliveries_user", "user_id", "created_at"), {"schema": SCHEMA})
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    notification_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), ForeignKey(f"{SCHEMA}.notifications.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(Integer)
    channel: Mapped[str] = mapped_column(String(10))  # inapp | webpush | apns
    subscription_id: Mapped[int | None] = mapped_column(Integer, ForeignKey(f"{SCHEMA}.push_subscriptions.id", ondelete="SET NULL"))
    status: Mapped[str] = mapped_column(String(12), default="queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    next_attempt_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    provider_status: Mapped[int | None] = mapped_column(Integer)
    last_error: Mapped[str | None] = mapped_column(String(300))
    created_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
    confirmed_at: Mapped[datetime | None] = mapped_column(TS)
    clicked_at: Mapped[datetime | None] = mapped_column(TS)


class NotifyPrefs(Base):
    """What a person wants: push on or off, categories switched off, and hours of quiet."""
    __tablename__ = "notify_prefs"
    __table_args__ = {"schema": SCHEMA}
    user_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    push_enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    muted_categories: Mapped[list] = mapped_column(JSONB, default=list, server_default=text("'[]'::jsonb"))
    quiet_from: Mapped[time | None] = mapped_column(Time)  # Nepal time
    quiet_to: Mapped[time | None] = mapped_column(Time)
    updated_at: Mapped[datetime] = mapped_column(TS, server_default=func.now())
