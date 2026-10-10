import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, Header, Query
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SCHEMA, get_db
from ..deps import Client, Principal, client_info, current, require
from ..errors import ApiError
from ..models.auth import Device
from ..models.notify import Delivery, Notification, NotifyPrefs, PushSubscription
from ..services import notify as svc
from ..services import push_senders

router = APIRouter(tags=["notifications"])


# ---------- this device ----------
@router.get("/push/config", summary="What the app needs to register for push: the public key and which channels are switched on")
def config(_: Principal = Depends(current())):
    s = get_settings()
    return {"webpush": {"enabled": s.webpush_ready, "public_key": s.vapid_public_key if s.webpush_ready else None}, "apns": {"enabled": s.apns_ready}, "categories": svc.CATEGORIES}


class Keys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=200)
    auth: str = Field(min_length=8, max_length=100)


class SubIn(BaseModel):
    channel: Literal["webpush", "apns"]
    endpoint: str = Field(min_length=10, max_length=2000)
    keys: Keys | None = None
    installation_id: str | None = Field(None, max_length=80)
    app_version: str | None = Field(None, max_length=40)


@router.post("/push/subscriptions", summary="Register this browser or phone for push. Called after the person has allowed notifications.")
def subscribe(body: SubIn, p: Principal = Depends(current()), db: Session = Depends(get_db), client: Client = Depends(client_info)):
    if body.channel == "webpush":
        if body.keys is None:
            raise ApiError(422, "A browser subscription needs its keys.", "invalid_request")
        if not push_senders.allowed_endpoint(body.endpoint):
            raise ApiError(422, "This is not the address of a known browser push service.", "invalid_request")
    elif not body.endpoint.isalnum():
        raise ApiError(422, "This is not a device token.", "invalid_request")
    dev = db.scalar(select(Device).where(Device.user_id == p.id, Device.installation_id == body.installation_id)) if body.installation_id else None
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if sub is None:
        sub = PushSubscription(endpoint=body.endpoint, channel=body.channel, user_id=p.id)
        db.add(sub)
    # A browser belongs to whoever is logged in on it now: the subscription moves with the login.
    sub.user_id, sub.channel, sub.device_id, sub.user_agent, sub.app_version = p.id, body.channel, dev.id if dev else None, client.user_agent, body.app_version
    sub.p256dh, sub.auth = (body.keys.p256dh, body.keys.auth) if body.keys else (None, None)
    sub.session_id = uuid.UUID(p.session_id) if p.session_id else None
    sub.active, sub.revoked_reason, sub.failures = True, None, 0
    db.flush()
    return {"id": sub.id, "active": True}


class UnsubIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=2000)


@router.post("/push/unsubscribe", summary="Stop push to this browser or phone (call at logout)")
def unsubscribe(body: UnsubIn, p: Principal = Depends(current(allow_temporary_password=True)), db: Session = Depends(get_db)):
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint, PushSubscription.user_id == p.id))
    if sub:
        sub.active, sub.revoked_reason = False, "unsubscribed"
    return {"ok": True}


def sub_view(s: PushSubscription) -> dict:
    """Never the keys or the full address: enough to recognise the device."""
    return {"id": s.id, "channel": s.channel, "service": s.endpoint.split("/")[2] if s.channel == "webpush" else "Apple", "user_agent": s.user_agent, "active": s.active, "created_at": s.created_at,
            "last_success_at": s.last_success_at, "last_failure_at": s.last_failure_at, "failures": s.failures, "revoked_reason": s.revoked_reason, "user_id": s.user_id}


@router.get("/push/subscriptions", summary="The devices this person has registered for push")
def my_subscriptions(p: Principal = Depends(current()), db: Session = Depends(get_db)):
    return {"subscriptions": [sub_view(s) for s in db.scalars(select(PushSubscription).where(PushSubscription.user_id == p.id).order_by(PushSubscription.created_at.desc()))]}


class AckIn(BaseModel):
    token: str = Field(min_length=3, max_length=80)
    clicked: bool = False


@router.post("/notifications/ack", summary="Called by the device when it has shown a push, and again when it is tapped. The token inside the push is the permission.")
def ack(body: AckIn, db: Session = Depends(get_db)):
    return {"ok": svc.confirm(db, body.token, body.clicked)}


class PrefsIn(BaseModel):
    push_enabled: bool = True
    muted_categories: list[str] = Field(default_factory=list, max_length=20)
    quiet_from: str | None = Field(None, max_length=5)
    quiet_to: str | None = Field(None, max_length=5)


def prefs_view(p: NotifyPrefs) -> dict:
    return {"push_enabled": p.push_enabled, "muted_categories": p.muted_categories or [], "quiet_from": p.quiet_from.strftime("%H:%M") if p.quiet_from else None,
            "quiet_to": p.quiet_to.strftime("%H:%M") if p.quiet_to else None, "categories": svc.CATEGORIES, "time_zone": "Asia/Kathmandu"}


def save_prefs(db: Session, user_id: int, body: PrefsIn) -> dict:
    bad = [c for c in body.muted_categories if c not in svc.CATEGORIES]
    if bad:
        raise ApiError(422, f"Unknown category: {bad[0]}.", "invalid_request")
    p = db.get(NotifyPrefs, user_id)
    if p is None:
        p = NotifyPrefs(user_id=user_id)
        db.add(p)
    p.push_enabled, p.muted_categories, p.quiet_from, p.quiet_to, p.updated_at = body.push_enabled, sorted(set(body.muted_categories)), svc.parse_time(body.quiet_from), svc.parse_time(body.quiet_to), func.now()
    db.flush()
    return prefs_view(p)


@router.get("/notifications/preferences", summary="This person's notification settings")
def my_prefs(p: Principal = Depends(current()), db: Session = Depends(get_db)):
    return prefs_view(svc.prefs_of(db, p.id))


@router.put("/notifications/preferences", summary="Set push on or off, muted kinds and quiet hours")
def set_my_prefs(body: PrefsIn, p: Principal = Depends(current()), db: Session = Depends(get_db)):
    return save_prefs(db, p.id, body)


# ---------- sending ----------
class Audience(BaseModel):
    kind: Literal["users", "role", "area", "region", "all"]
    ids: list[int] = Field(default_factory=list, max_length=5000)
    key: str | None = Field(None, max_length=40)
    id: int | None = None


class SendIn(BaseModel):
    title: str = Field(min_length=1, max_length=150)
    body: str | None = Field(None, max_length=500)
    category: str = "general"
    url: str | None = Field(None, max_length=300)
    icon: str | None = Field(None, max_length=300)
    data: dict = Field(default_factory=dict)
    audience: Audience
    priority: int = Field(5, ge=1, le=9)
    scheduled_at: datetime | None = None
    expires_at: datetime | None = None


def note_view(db: Session, n: Notification) -> dict:
    counts = dict(db.execute(select(Delivery.channel + ":" + Delivery.status, func.count()).where(Delivery.notification_id == n.id).group_by(Delivery.channel, Delivery.status)).all())
    return {"id": str(n.id), "title": n.title, "body": n.body, "category": n.category, "url": n.url, "audience": n.audience, "priority": n.priority, "status": n.status, "source": n.source,
            "scheduled_at": n.scheduled_at, "expires_at": n.expires_at, "created_at": n.created_at, "created_by": n.created_by, "deliveries": counts}


@router.post("/notifications", summary="Send now or schedule. Send an Idempotency-Key header so a repeated request does not send twice.")
def send(body: SendIn, p: Principal = Depends(current()), db: Session = Depends(get_db), idempotency_key: str | None = Header(None, max_length=100)):
    aud = body.audience.model_dump(exclude_none=True)
    svc.check_audience(p, aud)
    if len(str(body.data)) > 2000:
        raise ApiError(413, "The extra data is too large (2 KB at most).", "too_large")
    if body.icon and not body.icon.startswith("/"):
        raise ApiError(422, "The icon must be a path on this site.", "invalid_request")
    n, created = svc.create(db, title=body.title, body=body.body, audience=aud, category=body.category, url=body.url, icon=body.icon, data=body.data, priority=body.priority,
                            scheduled_at=body.scheduled_at, expires_at=body.expires_at, idempotency_key=f"api:{p.id}:{idempotency_key}" if idempotency_key else None, created_by=p.id)
    return {**note_view(db, n), "duplicate": not created}


def _note(db: Session, note_id: str) -> Notification:
    try:
        n = db.get(Notification, uuid.UUID(note_id))
    except ValueError:
        n = None
    if n is None:
        raise ApiError(404, "This notification does not exist.", "not_found")
    return n


@router.get("/notifications", summary="History of what was sent, newest first")
def history(_: Principal = Depends(require(svc.SEND, svc.MANAGE)), db: Session = Depends(get_db), source: str = Query("manual", pattern="^(manual|system|all)$"), limit: int = Query(30, ge=1, le=100), offset: int = Query(0, ge=0)):
    q = select(Notification).order_by(Notification.created_at.desc()).limit(limit).offset(offset)
    if source != "all":
        q = q.where(Notification.source == source)
    return {"notifications": [note_view(db, n) for n in db.scalars(q)]}


@router.get("/notifications/{note_id}", summary="One notification with every delivery attempt and its result")
def detail(note_id: str, _: Principal = Depends(require(svc.SEND, svc.MANAGE)), db: Session = Depends(get_db)):
    n = _note(db, note_id)
    rows = db.execute(text(f"""select d.id, d.user_id, u.name as user_name, d.channel, d.status, d.attempts, d.provider_status, d.last_error, d.next_attempt_at, d.updated_at, d.confirmed_at, d.clicked_at
                                 from {SCHEMA}.deliveries d join public.users u on u.id = d.user_id where d.notification_id = :n order by u.name, d.channel limit 2000"""), {"n": n.id}).mappings().all()  # noqa: S608
    return {**note_view(db, n), "attempts": [dict(r) for r in rows]}


@router.post("/notifications/{note_id}/cancel", summary="Cancel a scheduled notification, or withdraw the push not yet sent")
def cancel(note_id: str, _: Principal = Depends(require(svc.SEND)), db: Session = Depends(get_db)):
    n = _note(db, note_id)
    return {"status": n.status if n.status != "scheduled" else "cancelled", "withdrawn": svc.cancel(db, n)}


@router.post("/notifications/{note_id}/retry", summary="Queue again the push deliveries that failed, gave up or expired")
def retry(note_id: str, _: Principal = Depends(require(svc.MANAGE)), db: Session = Depends(get_db)):
    return {"requeued": svc.retry(db, notification_id=_note(db, note_id).id)}


# ---------- administration ----------
@router.get("/admin/notify/queue", summary="How the queue stands: counts by state, devices registered, how long the oldest due item has waited")
def queue(_: Principal = Depends(require(svc.MANAGE)), db: Session = Depends(get_db)):
    return svc.queue_stats(db)


@router.get("/admin/push/subscriptions", summary="Every registered device, without keys or full addresses")
def all_subscriptions(_: Principal = Depends(require(svc.MANAGE)), db: Session = Depends(get_db), user_id: int | None = None, active: bool | None = None, limit: int = Query(100, ge=1, le=500)):
    q = select(PushSubscription).order_by(PushSubscription.created_at.desc()).limit(limit)
    if user_id is not None:
        q = q.where(PushSubscription.user_id == user_id)
    if active is not None:
        q = q.where(PushSubscription.active == active)
    return {"subscriptions": [sub_view(s) for s in db.scalars(q)]}


@router.post("/admin/push/subscriptions/{sub_id}/disable", summary="Stop push to one device")
def disable(sub_id: int, _: Principal = Depends(require(svc.MANAGE)), db: Session = Depends(get_db)):
    s = db.get(PushSubscription, sub_id)
    if s is None:
        raise ApiError(404, "This device registration does not exist.", "not_found")
    s.active, s.revoked_reason = False, "switched off by an administrator"
    return {"ok": True}


@router.get("/admin/notify/users/{user_id}/preferences", summary="One person's notification settings")
def user_prefs(user_id: int, _: Principal = Depends(require(svc.MANAGE)), db: Session = Depends(get_db)):
    return prefs_view(svc.prefs_of(db, user_id))


@router.put("/admin/notify/users/{user_id}/preferences", summary="Change one person's notification settings")
def set_user_prefs(user_id: int, body: PrefsIn, _: Principal = Depends(require(svc.MANAGE)), db: Session = Depends(get_db)):
    return save_prefs(db, user_id, body)
