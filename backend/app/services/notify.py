"""The notification engine: who gets what, through which channel, and what became of each attempt.
Everything here is a plain function on a database session, so the worker, the API and the tests all use the same code."""
import base64
import hashlib
import hmac
import logging
import random
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, datetime, time, timedelta
from types import SimpleNamespace
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


def clean_audience(a: dict) -> dict:
    """The audience in its one stored form, or a refusal. Done before anything is saved, so a notification that cannot be delivered never enters the queue."""
    bad = ApiError(422, "Audience must be users (with ids), role (with key), area or region (with id), or all.", "invalid_request")
    kind = a.get("kind") if isinstance(a, dict) else None
    try:
        if kind == "users":
            ids = sorted({int(x) for x in a.get("ids") or [] if not isinstance(x, bool)})[:5000]
            if not ids:
                raise bad
            return {"kind": "users", "ids": ids}
        if kind == "role":
            key = str(a.get("key") or "")
            if not re.fullmatch(r"[a-z][a-z0-9_]{0,39}", key):
                raise bad
            return {"kind": "role", "key": key}
        if kind in ("area", "region"):
            if a.get("id") is None or isinstance(a.get("id"), bool):
                raise bad
            return {"kind": kind, "id": int(a["id"])}
        if kind == "all":
            return {"kind": "all"}
    except (TypeError, ValueError) as e:
        raise bad from e
    raise bad


MANY_PEOPLE = 200   # naming more people than this by id is a broadcast in all but name


def check_audience(p: Principal, a: dict, priority: int = 5):
    if not p.can(SEND):
        raise ApiError(403, "Your role does not allow sending notifications.", "forbidden")
    wide = a.get("kind") != "users" or len(a.get("ids") or []) > MANY_PEOPLE
    if wide and not p.can(BROADCAST):
        raise ApiError(403, "Sending to a whole role, area, region, everyone or more than 200 people needs the broadcast permission.", "forbidden")
    if priority <= 1 and not p.can(BROADCAST):
        raise ApiError(403, "Urgent notifications, which pass people's quiet hours, need the broadcast permission.", "forbidden")


_PATH = re.compile(r"/(?![/\\])[^\\\x00-\x20]*")


def safe_path(v: str | None) -> bool:
    """A path inside the app and nothing a browser could read as another site: one leading slash, no backslash, no spaces or control characters."""
    return bool(v) and len(v) <= 300 and bool(_PATH.fullmatch(v))


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
    if url and not safe_path(url):
        raise ApiError(422, "The link must be a path inside the app, such as /orders.", "invalid_request")
    if icon and not safe_path(icon):
        raise ApiError(422, "The icon must be a path on this site.", "invalid_request")
    audience = clean_audience(audience)
    if scheduled_at and scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=UTC)
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    later = bool(scheduled_at and scheduled_at > now() + timedelta(seconds=5))
    if expires_at and expires_at <= (scheduled_at if later else now()):
        raise ApiError(422, "The expiry time must be later than the time it is sent.", "invalid_request")
    n = Notification(title=title.strip()[:150], body=(body or "").strip()[:500] or None, category=category, url=url, icon=icon, data=data or {}, audience=audience, priority=priority,
                     status="scheduled" if later else "queued", scheduled_at=scheduled_at if later else None,
                     expires_at=expires_at or ((scheduled_at if later else now()) + DEFAULT_TTL), idempotency_key=idempotency_key, created_by=created_by, source=source)
    db.add(n)
    db.flush()
    if not later:
        fan_out(db, n)
    return n, True


def fan_out(db: Session, n: Notification) -> dict:
    """The in-app inbox is written here, always; push is queued for the worker, one row per device.
    Muting a kind, quiet hours and the hourly limit only ever hold back push. Nothing a person was sent is missing from their inbox."""
    s = get_settings()
    users = resolve_audience(db, n.audience)
    counts = {"people": len(users), "stored": 0, "push_queued": 0, "skipped": 0}
    if not users:
        n.status, n.fanned_out_at = "done", now()
        return counts
    # pushes really queued for each person in the last hour; rows that were held back do not count against them
    pushed = dict(db.execute(select(Delivery.user_id, func.count(func.distinct(Delivery.notification_id))).where(
        Delivery.user_id.in_(users), Delivery.created_at > now() - timedelta(hours=1), Delivery.channel != "inapp", Delivery.status != "skipped").group_by(Delivery.user_id)).all())
    subs: dict[int, list[PushSubscription]] = {}
    for sub in db.scalars(select(PushSubscription).where(PushSubscription.user_id.in_(users), PushSubscription.active)):
        if not login_ended(db, sub):
            subs.setdefault(sub.user_id, []).append(sub)
    prefs = {p.user_id: p for p in db.scalars(select(NotifyPrefs).where(NotifyPrefs.user_id.in_(users)))}
    for uid in users:
        p = prefs.get(uid) or NotifyPrefs(user_id=uid, push_enabled=True, muted_categories=[])
        if n.source == "manual":  # a system notification is already in the inbox: the web app wrote it
            db.execute(text("insert into public.notifications(user_id, title, body, link, origin, pushed_at) values (:u, :t, :b, :l, 'engine', now())"), {"u": uid, "t": n.title, "b": n.body, "l": n.url or "/dashboard"})
            emit(db, f"user:{uid}", "notification", {"title": n.title, "body": n.body, "link": n.url or "/dashboard", "category": n.category})
            db.add(Delivery(notification_id=n.id, user_id=uid, channel="inapp", status="stored"))
            counts["stored"] += 1
        mine = subs.get(uid, [])
        if not p.push_enabled or not mine:
            continue
        hold = "muted by the person" if n.category in (p.muted_categories or []) else "held back: too many notifications in the last hour" if n.priority > 1 and pushed.get(uid, 0) >= s.notify_per_user_hour else None
        if hold:
            db.add(Delivery(notification_id=n.id, user_id=uid, channel="push", status="skipped", last_error=hold))
            counts["skipped"] += 1
            continue
        wait = None if n.priority <= 1 else quiet_until(p, now())
        for sub in mine:
            db.add(Delivery(notification_id=n.id, user_id=uid, channel=sub.channel, subscription_id=sub.id, status="queued", next_attempt_at=wait or now()))
            counts["push_queued"] += 1
    n.status, n.fanned_out_at = "done", now()
    db.flush()
    return counts


def release_scheduled(db: Session) -> int:
    """Sends what has come due. One that cannot be sent is cancelled with the reason in the log; it must never hold up the others or the rest of the worker's round."""
    due = db.scalars(select(Notification).where(Notification.status == "scheduled", Notification.scheduled_at <= now()).with_for_update(skip_locked=True).limit(50)).all()
    done = 0
    for n in due:
        try:
            with db.begin_nested():
                fan_out(db, n)
            done += 1
        except Exception:
            log.exception("a scheduled notification could not be sent and was cancelled", extra={"notification": str(n.id)})
            db.execute(update(Notification).where(Notification.id == n.id).values(status="cancelled"))
    return done


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
    """The web app writes its notifications (order approved, booklet waiting ...) straight into the inbox. Pick up the new ones and queue push for them.
    Each inbox row carries its own "handed over" mark, so a row whose transaction finished late is still picked up; a position counter would step over it."""
    started = db.get(Setting, "notify.inbox_cursor", with_for_update=True)
    if started is None:  # first run: start from now, do not push history
        db.execute(text("update public.notifications set pushed_at = now() where pushed_at is null"))
        db.add(Setting(key="notify.inbox_cursor", value="started", label="Push for the web app's own notifications is switched on"))
        return 0
    if started.value.isdigit():  # written by an earlier version that kept a position: everything up to it was already handed over
        db.execute(text("update public.notifications set pushed_at = now() where pushed_at is null and id <= :c"), {"c": int(started.value)})
        started.value = "started"
    rows = db.execute(text("select id, user_id, title, body, link from public.notifications where pushed_at is null and origin is null order by id limit :l for update skip locked"), {"l": limit}).mappings().all()
    for r in rows:
        link = r["link"] if safe_path(r["link"]) else None
        create(db, title=r["title"] or "Notification", body=r["body"], audience={"kind": "users", "ids": [r["user_id"]]}, category=_CATEGORY_BY_LINK.get(r["link"] or "", "general"),
               url=link, source="system", idempotency_key=f"inbox:{r['id']}")
    if rows:
        db.execute(text("update public.notifications set pushed_at = now() where id = any(:ids)"), {"ids": [r["id"] for r in rows]})
    return len(rows)


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


def _send_one(job: tuple) -> push_senders.Result:
    """The network step for one delivery. Runs in a worker thread and touches nothing but its own arguments."""
    channel, sub, payload, ttl, urgent, did = job
    try:
        return push_senders.SENDERS[channel](sub, payload, ttl, urgent)
    except Exception:
        log.exception("push sender crashed", extra={"delivery": did})
        return push_senders.Result(ok=False, retry=True, error="internal error while sending")


def process_due(db: Session, limit: int | None = None) -> dict:
    """Takes a batch of due deliveries, hands them to the push services several at a time, and records each result the moment it is known.
    Waiting on the network is done side by side; the database work stays on this one connection.
    If the process dies mid-batch, the pushes still on the wire are sent again after the restart (the device shows one: same tag). At-least-once, never lost."""
    s = get_settings()
    out = {"accepted": 0, "failed": 0, "dead": 0, "expired": 0, "gone": 0}
    ready: list[tuple] = []   # (delivery id, job for the sender)
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
        elif sub.user_id != d.user_id:  # somebody else has logged in on that browser since this was queued: it is not theirs to see
            d.status, d.last_error = "dead", "another person is now logged in on that device"
            out["dead"] += 1
        elif login_ended(db, sub):  # logged out or locked out between queueing and sending: nothing may reach that screen
            d.status, d.last_error, sub.active, sub.revoked_reason = "dead", "the login on that device has ended", False, "login ended"
            out["dead"] += 1
        else:
            ttl = int((n.expires_at - now()).total_seconds()) if n.expires_at else 86400
            payload = {"id": str(n.id), "title": n.title, "body": n.body, "url": n.url or "/dashboard", "icon": n.icon, "category": n.category, "ack": _ack_token(d.id)}
            target = SimpleNamespace(id=sub.id, channel=sub.channel, endpoint=sub.endpoint, p256dh=sub.p256dh, auth=sub.auth)   # a plain copy: database objects do not cross threads
            ready.append((d.id, (d.channel, target, payload, ttl, n.priority <= 2, d.id)))
            continue
        d.updated_at = now()
        db.commit()

    def record(did: int, r: push_senders.Result):
        d = db.get(Delivery, did)
        db.refresh(d)   # the device may have reported "shown" while we were still waiting on the others
        sub = db.get(PushSubscription, d.subscription_id) if d.subscription_id else None
        moved_on = d.status != "processing"
        if r.ok:
            if not moved_on:
                d.status = "accepted"
            if sub:
                sub.last_success_at, sub.failures = now(), 0
            out["accepted"] += 1
        elif moved_on:
            pass
        elif r.gone:
            d.status = "dead"
            if sub:
                sub.active, sub.revoked_reason, sub.last_failure_at = False, (r.error or "gone")[:60], now()
            out["gone"] += 1
        elif r.retry and d.attempts < s.notify_max_attempts:
            d.status, d.next_attempt_at = "failed", now() + _backoff(d.attempts, r.retry_after)
            if sub:
                sub.last_failure_at, sub.failures = now(), sub.failures + 1
            out["failed"] += 1
        else:
            d.status = "dead"
            if sub:
                sub.last_failure_at, sub.failures = now(), sub.failures + 1
            out["dead"] += 1
        d.provider_status, d.last_error, d.updated_at = r.status, None if r.ok else (r.error or "")[:300], now()
        db.commit()  # saved one by one, as each answer arrives

    if len(ready) == 1 or (ready and s.notify_parallel <= 1):
        for did, job in ready:
            record(did, _send_one(job))
    elif ready:
        with ThreadPoolExecutor(max_workers=min(s.notify_parallel, len(ready)), thread_name_prefix="push") as pool:
            waiting = {pool.submit(_send_one, job): did for did, job in ready}
            for fut in as_completed(waiting):
                record(waiting[fut], fut.result())
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
