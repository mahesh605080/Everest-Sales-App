"""The notification engine: who gets what, through which channel, and what became of each attempt.
Everything here is a plain function on a database session, so the worker, the API and the tests all use the same code."""
import base64
import hashlib
import hmac
import logging
import random
from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from ..config import get_settings
from ..db import SCHEMA
from ..deps import Principal
from ..errors import ApiError
from ..models.meta import Setting
from ..models.notify import Delivery, Notification, NotifyPrefs, PushSubscription
from . import push_senders
from .events import emit

log = logging.getLogger("platform.notify")
NPT = ZoneInfo("Asia/Kathmandu")
CATEGORIES = ["general", "orders", "approvals", "collections", "stock", "chat", "announcements"]
SEND, BROADCAST, MANAGE = "notify.send", "notify.broadcast", "notify.manage"
DEFAULT_TTL = timedelta(hours=24)
now = lambda: datetime.now(UTC)  # noqa: E731


# ---------- who ----------
def resolve_audience(db: Session, a: dict) -> list[int]:
    kind = a.get("kind")
    base = "select u.id from public.users u join public.roles r on r.id = u.role_id where u.active and r.active"
    if kind == "users":
        ids = sorted({int(x) for x in a.get("ids", [])})[:5000]
        return [r[0] for r in db.execute(text(base + " and u.id = any(:ids) order by u.id"), {"ids": ids})]
    if kind == "role":
        return [r[0] for r in db.execute(text(base + " and r.key = :k order by u.id"), {"k": str(a.get("key"))})]
    if kind == "area":
        return [r[0] for r in db.execute(text(base + " and u.area_id = :i order by u.id"), {"i": int(a.get("id"))})]
    if kind == "region":
        return [r[0] for r in db.execute(text(base + " and u.region_id = :i order by u.id"), {"i": int(a.get("id"))})]
    if kind == "all":
        return [r[0] for r in db.execute(text(base + " order by u.id"))]
    raise ApiError(422, "Audience must be users, role, area, region or all.", "invalid_request")


def check_audience(p: Principal, a: dict):
    if not p.can(SEND):
        raise ApiError(403, "Your role does not allow sending notifications.", "forbidden")
    if a.get("kind") != "users" and not p.can(BROADCAST):
        raise ApiError(403, "Sending to a whole role, area, region or everyone needs the broadcast permission.", "forbidden")


def prefs_of(db: Session, user_id: int) -> NotifyPrefs:
    return db.get(NotifyPrefs, user_id) or NotifyPrefs(user_id=user_id, push_enabled=True, muted_categories=[], quiet_from=None, quiet_to=None)


def quiet_until(p: NotifyPrefs, at: datetime) -> datetime | None:
    """If `at` falls in the person's quiet hours (Nepal time), the moment they end; otherwise None."""
    if p.quiet_from is None or p.quiet_to is None or p.quiet_from == p.quiet_to:
        return None
    local = at.astimezone(NPT)
    t, a, b = local.time(), p.quiet_from, p.quiet_to
    inside = (a <= t < b) if a < b else (t >= a or t < b)  # the second form is a night that crosses midnight
    if not inside:
        return None
    end = local.replace(hour=b.hour, minute=b.minute, second=0, microsecond=0)
    if end <= local:
        end += timedelta(days=1)
    return end.astimezone(UTC)


def login_ended(db: Session, sub: PushSubscription) -> bool:
    """True when the login a device was registered under is over: logged out, revoked, expired, or the password was changed since."""
    if sub.session_id is None:
        return False
    return not db.execute(text(f"select 1 from {SCHEMA}.sessions s join public.users u on u.id = s.user_id where s.id = :i and s.revoked_at is null and s.expires_at > now() and s.token_version = u.token_version"),  # noqa: S608
                          {"i": sub.session_id}).first()


# ---------- create and fan out ----------
def create(db: Session, *, title: str, body: str | None, audience: dict, category: str = "general", url: str | None = None, icon: str | None = None, data: dict | None = None,
           priority: int = 5, scheduled_at: datetime | None = None, expires_at: datetime | None = None, idempotency_key: str | None = None, created_by: int | None = None,
           source: str = "manual") -> tuple[Notification, bool]:
    """Returns (notification, created). The same idempotency key gives back the first one instead of sending again."""
    if idempotency_key:
        had = db.scalar(select(Notification).where(Notification.idempotency_key == idempotency_key))
        if had:
            return had, False
    if category not in CATEGORIES:
        raise ApiError(422, f"Category must be one of: {', '.join(CATEGORIES)}.", "invalid_request")
    if url and not (url.startswith("/") and not url.startswith("//")):
        raise ApiError(422, "The link must be a path inside the app, such as /orders.", "invalid_request")
    if scheduled_at and scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=UTC)
    later = bool(scheduled_at and scheduled_at > now() + timedelta(seconds=5))
    n = Notification(title=title.strip()[:150], body=(body or "").strip()[:500] or None, category=category, url=url, icon=icon, data=data or {}, audience=audience, priority=priority,
                     status="scheduled" if later else "queued", scheduled_at=scheduled_at if later else None,
                     expires_at=expires_at or ((scheduled_at if later else now()) + DEFAULT_TTL), idempotency_key=idempotency_key, created_by=created_by, source=source)
    db.add(n)
    db.flush()
    if not later:
        fan_out(db, n)
    return n, True


def fan_out(db: Session, n: Notification) -> dict:
    """One delivery row per person and channel. The in-app inbox is written here; push is queued for the worker."""
    s = get_settings()
    users = resolve_audience(db, n.audience)
    counts = {"people": len(users), "stored": 0, "push_queued": 0, "skipped": 0}
    if not users:
        n.status, n.fanned_out_at = "done", now()
        return counts
    recent = dict(db.execute(select(Delivery.user_id, func.count(func.distinct(Delivery.notification_id))).where(Delivery.user_id.in_(users), Delivery.created_at > now() - timedelta(hours=1)).group_by(Delivery.user_id)).all())
    subs: dict[int, list[PushSubscription]] = {}
    for sub in db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_(users), PushSubscription.active)):
        if not login_ended(db, sub):
            subs.setdefault(sub.user_id, []).append(sub)
    prefs = {p.user_id: p for p in db.scalars(select(NotifyPrefs).where(NotifyPrefs.user_id.in_(users)))}
    for uid in users:
        p = prefs.get(uid) or NotifyPrefs(user_id=uid, push_enabled=True, muted_categories=[])
        skip = "muted by the person" if n.category in (p.muted_categories or []) else "held back: too many notifications in the last hour" if n.priority > 1 and recent.get(uid, 0) >= s.notify_per_user_hour else None
        if skip:
            db.add(Delivery(notification_id=n.id, user_id=uid, channel="inapp", status="skipped", last_error=skip))
            counts["skipped"] += 1
            continue
        if n.source == "manual":  # a system notification is already in the inbox: the web app wrote it
            db.execute(text("insert into public.notifications(user_id, title, body, link, origin) values (:u, :t, :b, :l, 'engine')"), {"u": uid, "t": n.title, "b": n.body, "l": n.url or "/dashboard"})
            emit(db, f"user:{uid}", "notification", {"title": n.title, "body": n.body, "link": n.url or "/dashboard", "category": n.category})
            db.add(Delivery(notification_id=n.id, user_id=uid, channel="inapp", status="stored"))
            counts["stored"] += 1
        if not p.push_enabled:
            continue
        wait = None if n.priority <= 1 else quiet_until(p, now())
        for sub in subs.get(uid, []):
            db.add(Delivery(notification_id=n.id, user_id=uid, channel=sub.channel, subscription_id=sub.id, status="queued", next_attempt_at=wait or now()))
            counts["push_queued"] += 1
    n.status, n.fanned_out_at = "done", now()
    db.flush()
    return counts


def release_scheduled(db: Session) -> int:
    due = db.scalars(select(Notification).where(Notification.status == "scheduled", Notification.scheduled_at <= now()).with_for_update(skip_locked=True).limit(50)).all()
    for n in due:
        fan_out(db, n)
    return len(due)


def cancel(db: Session, n: Notification) -> int:
    """A scheduled notification is stopped entirely; one already sent has its still-waiting push deliveries withdrawn."""
    if n.status == "scheduled":
        n.status = "cancelled"
        return 0
    done = db.execute(update(Delivery).where(Delivery.notification_id == n.id, Delivery.status.in_(["queued", "failed"])).values(status="skipped", last_error="cancelled", updated_at=now()).returning(Delivery.id)).all()
    return len(done)


# ---------- the system's own notifications ----------
_CATEGORY_BY_LINK = {"/orders": "orders", "/credit": "orders", "/booklets": "approvals", "/approvals": "approvals", "/r/collections": "collections", "/r/claims": "approvals", "/expiry": "stock", "/stock": "stock"}


def ingest_system(db: Session, limit: int = 200) -> int:
    """The web app writes its notifications (order approved, booklet waiting ...) straight into the inbox. Pick up the new ones and queue push for them."""
    cur = db.get(Setting, "notify.inbox_cursor", with_for_update=True)
    top = db.execute(text("select coalesce(max(id), 0) from public.notifications")).scalar_one()
    if cur is None:  # first run: start from now, do not push history
        db.add(Setting(key="notify.inbox_cursor", value=str(top), label="Last inbox row handed to the push queue"))
        return 0
    rows = db.execute(text("select id, user_id, title, body, link, origin from public.notifications where id > :c order by id limit :l"), {"c": int(cur.value), "l": limit}).mappings().all()
    made = 0
    for r in rows:
        if r["origin"] is None:  # rows marked 'engine' were written by a manual send and are already being delivered
            create(db, title=r["title"], body=r["body"], audience={"kind": "users", "ids": [r["user_id"]]}, category=_CATEGORY_BY_LINK.get(r["link"] or "", "general"),
                   url=r["link"] if (r["link"] or "").startswith("/") else None, source="system", idempotency_key=f"inbox:{r['id']}")
            made += 1
        cur.value = str(r["id"])
    return made


# ---------- sending ----------
def _ack_token(delivery_id: int) -> str:
    sig = hmac.new(hashlib.sha256(b"notify-ack:" + get_settings().auth_secret.encode()).digest(), str(delivery_id).encode(), hashlib.sha256).digest()[:12]
    return f"{delivery_id}.{base64.urlsafe_b64encode(sig).decode().rstrip('=')}"


def confirm(db: Session, token: str, clicked: bool) -> bool:
    """The device tells us it showed (or the person tapped) the notification. This is the only thing we call 'confirmed'."""
    try:
        did = int(token.split(".", 1)[0])
    except ValueError:
        return False
    if not hmac.compare_digest(_ack_token(did), token):
        return False
    d = db.get(Delivery, did)
    if d is None:
        return False
    d.confirmed_at = d.confirmed_at or now()
    if clicked:
        d.clicked_at = d.clicked_at or now()
    if d.status in ("accepted", "processing", "queued", "failed"):
        d.status = "confirmed"
    d.updated_at = now()
    return True


def _backoff(attempt: int, retry_after: int | None) -> timedelta:
    base = min(3600, 30 * 2 ** max(0, attempt - 1))  # 30 s, 1 min, 2, 4, 8 ... capped at an hour
    return timedelta(seconds=max(retry_after or 0, base * random.uniform(0.5, 1.5)))  # noqa: S311  jitter, so retries do not arrive together


def claim_due(db: Session, limit: int) -> list[int]:
    """Takes a batch of deliveries that are due, marking them 'processing' so no other worker takes the same ones."""
    ids = [r[0] for r in db.execute(select(Delivery.id).where(Delivery.status.in_(["queued", "failed"]), Delivery.next_attempt_at <= now(), Delivery.channel != "inapp")
                                    .order_by(Delivery.next_attempt_at).limit(limit).with_for_update(skip_locked=True))]
    if ids:
        db.execute(update(Delivery).where(Delivery.id.in_(ids)).values(status="processing", attempts=Delivery.attempts + 1, updated_at=now()))
    db.commit()
    return ids


def process_due(db: Session, limit: int | None = None) -> dict:
    s = get_settings()
    out = {"accepted": 0, "failed": 0, "dead": 0, "expired": 0, "gone": 0}
    for did in claim_due(db, limit or s.notify_batch):
        d = db.get(Delivery, did)
        n = db.get(Notification, d.notification_id)
        sub = db.get(PushSubscription, d.subscription_id) if d.subscription_id else None
        if n.expires_at and n.expires_at <= now():
            d.status, d.last_error = "expired", "not sent before it expired"
            out["expired"] += 1
        elif sub is None or not sub.active:
            d.status, d.last_error = "dead", "the device is no longer registered"
            out["dead"] += 1
        elif login_ended(db, sub):  # logged out or locked out between queueing and sending: nothing may reach that screen
            d.status, d.last_error, sub.active, sub.revoked_reason = "dead", "the login on that device has ended", False, "login ended"
            out["dead"] += 1
        else:
            ttl = int((n.expires_at - now()).total_seconds()) if n.expires_at else 86400
            payload = {"id": str(n.id), "title": n.title, "body": n.body, "url": n.url or "/dashboard", "icon": n.icon, "category": n.category, "ack": _ack_token(d.id)}
            try:
                r = push_senders.SENDERS[d.channel](sub, payload, ttl, n.priority <= 2)
            except Exception:
                log.exception("push sender crashed", extra={"delivery": d.id})
                r = push_senders.Result(ok=False, retry=True, error="internal error while sending")
            d.provider_status, d.last_error = r.status, None if r.ok else (r.error or "")[:300]
            if r.ok:
                d.status, sub.last_success_at, sub.failures = "accepted", now(), 0
                out["accepted"] += 1
            elif r.gone:
                d.status, sub.active, sub.revoked_reason, sub.last_failure_at = "dead", False, (r.error or "gone")[:60], now()
                out["gone"] += 1
            elif r.retry and d.attempts < s.notify_max_attempts:
                d.status, d.next_attempt_at, sub.last_failure_at, sub.failures = "failed", now() + _backoff(d.attempts, r.retry_after), now(), sub.failures + 1
                out["failed"] += 1
            else:
                d.status, sub.last_failure_at, sub.failures = "dead", now(), sub.failures + 1
                out["dead"] += 1
        d.updated_at = now()
        db.commit()  # each result is saved on its own, so a crash loses at most the one in hand
    return out


def recover_stuck(db: Session, minutes: int = 5) -> int:
    """A worker that died mid-send leaves rows in 'processing'. Put them back in the queue."""
    return len(db.execute(update(Delivery).where(Delivery.status == "processing", Delivery.updated_at < now() - timedelta(minutes=minutes)).values(status="queued", next_attempt_at=now()).returning(Delivery.id)).all())


def retry(db: Session, notification_id=None, delivery_id: int | None = None) -> int:
    q = update(Delivery).where(Delivery.status.in_(["dead", "failed", "expired"]), Delivery.channel != "inapp").values(status="queued", attempts=0, next_attempt_at=now(), last_error=None, updated_at=now())
    q = q.where(Delivery.id == delivery_id) if delivery_id else q.where(Delivery.notification_id == notification_id)
    ids = [r[0] for r in db.execute(q.returning(Delivery.notification_id)).all()]
    if ids:  # give them a fresh day to arrive
        db.execute(update(Notification).where(Notification.id.in_(set(ids))).values(expires_at=now() + DEFAULT_TTL))
    return len(ids)


def queue_stats(db: Session) -> dict:
    rows = dict(db.execute(text(f"select status, count(*) from {SCHEMA}.deliveries where created_at > now() - interval '7 days' group by 1")).all())  # noqa: S608
    subs = dict(db.execute(text(f"select channel || ':' || case when active then 'active' else 'off' end, count(*) from {SCHEMA}.push_subscriptions group by 1")).all())  # noqa: S608
    oldest = db.execute(text(f"select extract(epoch from now() - min(next_attempt_at)) from {SCHEMA}.deliveries where status in ('queued','failed') and next_attempt_at <= now() and channel <> 'inapp'")).scalar()  # noqa: S608
    s = get_settings()
    return {"last_7_days": rows, "subscriptions": subs, "oldest_due_seconds": float(oldest) if oldest is not None else 0, "scheduled": db.scalar(select(func.count()).select_from(Notification).where(Notification.status == "scheduled")),
            "channels": {"webpush": s.webpush_ready, "apns": s.apns_ready}}


def parse_time(v: str | None) -> time | None:
    if not v:
        return None
    try:
        h, m = v.split(":")[:2]
        return time(int(h), int(m))
    except ValueError as e:
        raise ApiError(422, "Give quiet hours as HH:MM, for example 21:00.", "invalid_request") from e
