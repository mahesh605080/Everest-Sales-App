import base64
import json
from datetime import UTC, datetime, time, timedelta

import http_ece
import jwt
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app import worker
from app.config import get_settings
from app.models.notify import Delivery, Notification, NotifyPrefs, PushSubscription
from app.services import notify as svc
from app.services import push_senders
from app.services.push_senders import Result

N = "/api/v1/notifications"
P = "/api/v1/push"
SO01, SO02, SO03, GM = 10, 11, 12, 2
b64 = lambda b: base64.urlsafe_b64encode(b).decode().rstrip("=")  # noqa: E731
unb64 = lambda s: base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))  # noqa: E731


def keypair():
    k = ec.generate_private_key(ec.SECP256R1())
    return k, b64(k.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)), b64(k.private_numbers().private_value.to_bytes(32, "big"))


class Browser:
    """What a browser holds for one push subscription: its own key pair and shared secret. Only the public half goes to the server."""
    def __init__(self, name="abc", host="fcm.googleapis.com"):
        self.key, self.p256dh, _ = keypair()
        self.auth_raw = b"0123456789abcdef"
        self.endpoint = f"https://{host}/fcm/send/{name}"

    def body(self, **extra):
        return {"channel": "webpush", "endpoint": self.endpoint, "keys": {"p256dh": self.p256dh, "auth": b64(self.auth_raw)}, **extra}

    def decrypt(self, data: bytes) -> dict:
        return json.loads(http_ece.decrypt(data, private_key=self.key, auth_secret=self.auth_raw, version="aes128gcm"))


@pytest.fixture(autouse=True)
def clean(sql):
    sql("delete from platform.notifications")
    sql("delete from platform.push_subscriptions")
    sql("delete from platform.notify_prefs")
    sql("delete from platform.settings where key = 'notify.inbox_cursor'")
    sql("delete from public.notifications where title like 'T:%'")
    yield
    get_settings.cache_clear()


@pytest.fixture()
def vapid(monkeypatch):
    _, pub, priv = keypair()
    monkeypatch.setenv("VAPID_PUBLIC_KEY", pub)
    monkeypatch.setenv("VAPID_PRIVATE_KEY", priv)
    monkeypatch.setenv("VAPID_SUBJECT", "mailto:it@everest.example")
    get_settings.cache_clear()
    return pub


@pytest.fixture()
def sender(monkeypatch):
    """Replaces the network step with a scripted push service, so queue behaviour can be tested for every kind of answer."""
    box = {"result": Result(ok=True, status=201), "calls": []}

    def fake(sub, payload, ttl, urgent):
        box["calls"].append({"endpoint": sub.endpoint, "payload": payload, "ttl": ttl, "urgent": urgent})
        r = box["result"]
        return r(sub, payload) if callable(r) else r
    monkeypatch.setitem(push_senders.SENDERS, "webpush", fake)
    monkeypatch.setitem(push_senders.SENDERS, "apns", fake)
    return box


def send(client, h, to=(SO01,), title="T: hello", **extra):
    aud = extra.pop("audience", {"kind": "users", "ids": list(to)})
    headers = {**h, **({"idempotency-key": extra.pop("key")} if "key" in extra else {})}
    return client.post(N, json={"title": title, "body": "body text", "audience": aud, **extra}, headers=headers)


def subscribe(client, h, browser=None, **extra):
    browser = browser or Browser()
    r = client.post(f"{P}/subscriptions", json=browser.body(**extra), headers=h)
    assert r.status_code == 200, r.text
    return browser, r.json()["id"]


def deliveries(sql, note_id, channel=None):
    q = "select id, user_id, channel, status, attempts, last_error, next_attempt_at, provider_status, confirmed_at, clicked_at from platform.deliveries where notification_id = cast(:n as uuid)"
    rows = [dict(r) for r in sql(q + " order by id", n=note_id).mappings()]
    return [r for r in rows if channel is None or r["channel"] == channel]


# ---------- who may send, and to whom ----------
def test_sending_needs_permission_and_broadcast_needs_more(client, as_user, sql):
    so, gm = as_user("SO01"), as_user("GM01")
    assert client.post(N, json={"title": "T: x", "audience": {"kind": "users", "ids": [SO02]}}).status_code == 401
    assert send(client, so, to=[SO02]).status_code == 403
    sql("update public.roles set permissions = permissions || '[\"notify.send\"]'::jsonb where key = 'so'")
    try:
        assert send(client, so, to=[SO02]).status_code == 200
        r = send(client, so, audience={"kind": "all"})
        assert r.status_code == 403 and "broadcast" in r.json()["error"]
        assert send(client, so, audience={"kind": "role", "key": "so"}).status_code == 403
        assert client.get(N, headers=so).status_code == 200            # may see history of what was sent
        assert client.get("/api/v1/admin/notify/queue", headers=so).status_code == 403
    finally:
        sql("update public.roles set permissions = permissions - 'notify.send' where key = 'so'")
    assert send(client, gm, audience={"kind": "role", "key": "so"}).json()["deliveries"] == {"inapp:stored": 10}
    assert send(client, gm, audience={"kind": "area", "id": 3}).json()["deliveries"] == {"inapp:stored": 2}     # ASM01 and SO01
    assert send(client, gm, audience={"kind": "region", "id": 1}).json()["deliveries"] == {"inapp:stored": 4}
    assert send(client, gm, audience={"kind": "all"}).json()["deliveries"] == {"inapp:stored": 19}
    assert client.get("/api/v1/admin/notify/queue", headers=gm).status_code == 403   # the queue is for the Super Admin
    assert client.get("/api/v1/admin/notify/queue", headers=as_user("ADMIN")).status_code == 200


def test_bad_requests_are_refused(client, as_user):
    gm = as_user("GM01")
    past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    for extra in [{"category": "nonsense"}, {"url": "https://evil.example/x"}, {"url": "//evil.example"}, {"icon": "https://evil.example/i.png"}, {"priority": 0}, {"title": ""},
                  {"audience": {"kind": "everyone"}}, {"url": "/\\evil.example/x"}, {"url": "/\t/evil.example"}, {"url": "/a b"}, {"icon": "//evil.example/p.png"}, {"icon": "/\\evil.example/p.png"},
                  {"audience": {"kind": "area"}}, {"audience": {"kind": "region"}}, {"audience": {"kind": "role"}}, {"audience": {"kind": "role", "key": "x; drop"}}, {"audience": {"kind": "users", "ids": []}},
                  {"expires_at": past}, {"audience": {"kind": "area"}, "scheduled_at": (datetime.now(UTC) + timedelta(hours=1)).isoformat()}]:
        assert send(client, gm, **extra).status_code == 422, extra
    assert send(client, gm, data={"k": "x" * 3000}).status_code == 413
    assert client.get(f"{N}/not-a-uuid", headers=gm).status_code == 404


def test_inactive_people_are_left_out(client, as_user, sql):
    sql("update public.users set active = false where id = :i", i=SO03)
    try:
        r = send(client, as_user("GM01"), to=[SO01, SO03, 99999]).json()
        assert r["deliveries"] == {"inapp:stored": 1}
    finally:
        sql("update public.users set active = true where id = :i", i=SO03)


# ---------- the in-app inbox ----------
def test_a_send_lands_in_the_inbox_and_on_the_live_channel(client, as_user, sql):
    before = sql("select coalesce(max(id), 0) from platform.events").scalar()
    r = send(client, as_user("GM01"), to=[SO01, SO02], title="T: stock arrived", url="/stock", category="stock")
    assert r.status_code == 200 and r.json()["status"] == "done" and r.json()["duplicate"] is False
    rows = sql("select user_id, title, link, origin from public.notifications where title = 'T: stock arrived' order by user_id").all()
    assert [tuple(x) for x in rows] == [(SO01, "T: stock arrived", "/stock", "engine"), (SO02, "T: stock arrived", "/stock", "engine")]
    ev = sql("select channel, type, payload->>'title' from platform.events where id > :b order by id", b=before).all()
    assert [tuple(x) for x in ev] == [(f"user:{SO01}", "notification", "T: stock arrived"), (f"user:{SO02}", "notification", "T: stock arrived")]
    d = deliveries(sql, r.json()["id"])
    assert [(x["user_id"], x["channel"], x["status"]) for x in d] == [(SO01, "inapp", "stored"), (SO02, "inapp", "stored")]  # nobody has a device registered: nothing is claimed to be pushed


def test_same_idempotency_key_sends_once(client, as_user, sql):
    gm = as_user("GM01")
    a = send(client, gm, title="T: once", key="k-1").json()
    b = send(client, gm, title="T: once", key="k-1").json()
    assert a["id"] == b["id"] and a["duplicate"] is False and b["duplicate"] is True
    assert sql("select count(*) from public.notifications where title = 'T: once'").scalar() == 1
    assert send(client, as_user("ADMIN"), title="T: once", key="k-1").json()["id"] != a["id"]   # keys are per sender
    assert send(client, gm, title="T: once").json()["id"] != a["id"]                              # without a key every request sends


def test_schedule_release_and_cancel(client, as_user, sql, db):
    gm = as_user("GM01")
    at = (datetime.now(UTC) + timedelta(hours=2)).isoformat()
    a = send(client, gm, title="T: later", scheduled_at=at).json()
    b = send(client, gm, title="T: never", scheduled_at=at).json()
    assert a["status"] == b["status"] == "scheduled" and a["deliveries"] == {}
    assert sql("select count(*) from public.notifications where title in ('T: later', 'T: never')").scalar() == 0
    assert client.post(f"{N}/{b['id']}/cancel", headers=gm).json() == {"status": "cancelled", "withdrawn": 0}
    assert svc.release_scheduled(db) == 0                      # not due yet
    sql("update platform.notifications set scheduled_at = now() - interval '1 minute' where status in ('scheduled', 'cancelled')")
    assert svc.release_scheduled(db) == 1
    db.commit()
    assert sql("select title from public.notifications where title in ('T: later', 'T: never')").scalars().all() == ["T: later"]
    assert svc.release_scheduled(db) == 0                      # released once only
    assert client.get(f"{N}/{a['id']}", headers=gm).json()["status"] == "done"


# ---------- registering a device ----------
def test_subscription_rules(client, as_user, sql):
    so = as_user("SO01")
    br = Browser()
    assert client.post(f"{P}/subscriptions", json=br.body()).status_code == 401
    for bad in ["https://evil.example/push/1", "http://fcm.googleapis.com/fcm/send/1", "https://fcm.googleapis.com.evil.example/x", "https://127.0.0.1/internal", "https://169.254.169.254/latest/meta-data"]:
        r = client.post(f"{P}/subscriptions", json={**br.body(), "endpoint": bad}, headers=so)
        assert r.status_code == 422, bad                       # the server will only ever call a real browser push service
    assert client.post(f"{P}/subscriptions", json={"channel": "webpush", "endpoint": br.endpoint}, headers=so).status_code == 422
    assert client.post(f"{P}/subscriptions", json={"channel": "apns", "endpoint": "../../etc/passwd"}, headers=so).status_code == 422
    _, sid = subscribe(client, so, br)
    _, again = subscribe(client, so, br)
    assert sid == again and sql("select count(*) from platform.push_subscriptions").scalar() == 1
    mine = client.get(f"{P}/subscriptions", headers=so).json()["subscriptions"]
    assert len(mine) == 1 and mine[0]["service"] == "fcm.googleapis.com" and mine[0]["active"] is True
    text = json.dumps(mine) + client.get("/api/v1/admin/push/subscriptions", headers=as_user("ADMIN")).text
    assert br.p256dh not in text and b64(br.auth_raw) not in text and br.endpoint not in text   # keys and the full address never leave the server
    assert client.get(f"{P}/subscriptions", headers=as_user("SO02")).json()["subscriptions"] == []


def test_a_shared_browser_follows_whoever_is_logged_in(client, as_user, sql, sender, db):
    br, sid = subscribe(client, as_user("SO01"))
    _, same = subscribe(client, as_user("SO02"), br)            # SO02 logs in on the same browser
    assert same == sid and sql("select user_id from platform.push_subscriptions").scalars().all() == [SO02]
    n = send(client, as_user("GM01"), to=[SO01]).json()         # SO01's message must not appear on SO02's screen
    assert n["deliveries"] == {"inapp:stored": 1}
    # logging out switches push off for that browser; somebody else cannot do it for you
    assert client.post(f"{P}/unsubscribe", json={"endpoint": br.endpoint}, headers=as_user("SO01")).json() == {"ok": True}
    assert sql("select active from platform.push_subscriptions").scalar() is True
    client.post(f"{P}/unsubscribe", json={"endpoint": br.endpoint}, headers=as_user("SO02"))
    assert sql("select active, revoked_reason from platform.push_subscriptions").one() == (False, "unsubscribed")
    assert send(client, as_user("GM01"), to=[SO02]).json()["deliveries"] == {"inapp:stored": 1}


def test_push_config_gives_only_the_public_key(client, as_user, vapid):
    assert client.get(f"{P}/config").status_code == 401
    c = client.get(f"{P}/config", headers=as_user("SO01"))
    assert c.json()["webpush"] == {"enabled": True, "public_key": vapid} and c.json()["apns"] == {"enabled": False}
    assert get_settings().vapid_private_key not in c.text


def test_without_keys_push_is_reported_off_and_nothing_is_called_delivered(client, as_user, sql, db):
    assert client.get(f"{P}/config", headers=as_user("SO01")).json()["webpush"] == {"enabled": False, "public_key": None}
    subscribe(client, as_user("SO01"))
    n = send(client, as_user("GM01")).json()
    assert svc.process_due(db)["dead"] == 1
    d = deliveries(sql, n["id"], "webpush")[0]
    assert d["status"] == "dead" and "not configured" in d["last_error"]


# ---------- what the person asked for ----------
def test_preferences(client, as_user, sql, sender, db):
    so = as_user("SO01")
    U = f"{N}/preferences"
    assert client.get(U, headers=so).json()["push_enabled"] is True
    assert client.put(U, json={"muted_categories": ["nope"]}, headers=so).status_code == 422
    assert client.put(U, json={"quiet_from": "25:99", "quiet_to": "07:00"}, headers=so).status_code == 422
    assert client.put(U, json={"quiet_from": "abc"}, headers=so).status_code == 422
    subscribe(client, so)
    gm = as_user("GM01")
    client.put(U, json={"muted_categories": ["stock"]}, headers=so)
    muted = send(client, gm, title="T: muted", category="stock").json()
    assert muted["deliveries"] == {"inapp:stored": 1, "push:skipped": 1}                       # muting stops the push, never the inbox
    assert sql("select count(*) from public.notifications where title = 'T: muted'").scalar() == 1
    assert send(client, gm, title="T: other", category="orders").json()["deliveries"] == {"inapp:stored": 1, "webpush:queued": 1}
    client.put(U, json={"push_enabled": False}, headers=so)
    assert send(client, gm, title="T: nopush").json()["deliveries"] == {"inapp:stored": 1}   # still in the inbox, never pushed
    # an administrator can see and change a person's settings; others cannot
    assert client.get(f"/api/v1/admin/notify/users/{SO01}/preferences", headers=gm).status_code == 403
    assert client.get(f"/api/v1/admin/notify/users/{SO01}/preferences", headers=as_user("ADMIN")).json()["push_enabled"] is False


def test_quiet_hours_hold_push_but_not_urgent_ones(client, as_user, sql, db, sender):
    so = as_user("SO01")
    subscribe(client, so)
    local = datetime.now(svc.NPT)
    frm, to = (local - timedelta(hours=1)).strftime("%H:%M"), (local + timedelta(hours=2)).strftime("%H:%M")
    assert client.put(f"{N}/preferences", json={"quiet_from": frm, "quiet_to": to}, headers=so).json()["quiet_from"] == frm
    gm = as_user("GM01")
    held = send(client, gm, title="T: held").json()
    urgent = send(client, gm, title="T: urgent", priority=1).json()
    wait = deliveries(sql, held["id"], "webpush")[0]["next_attempt_at"] - datetime.now(UTC)
    assert timedelta(hours=1, minutes=55) < wait <= timedelta(hours=2, minutes=1)
    assert sql("select count(*) from public.notifications where title = 'T: held'").scalar() == 1   # the inbox is not delayed
    assert svc.process_due(db)["accepted"] == 1
    assert [c["payload"]["title"] for c in sender["calls"]] == ["T: urgent"] and sender["calls"][0]["urgent"] is True
    assert deliveries(sql, urgent["id"], "webpush")[0]["status"] == "accepted" and deliveries(sql, held["id"], "webpush")[0]["status"] == "queued"


def test_quiet_hours_arithmetic():
    at = lambda h, m=0: datetime(2026, 10, 10, h, m, tzinfo=svc.NPT)  # noqa: E731
    night = NotifyPrefs(user_id=1, quiet_from=time(21, 0), quiet_to=time(7, 0))
    assert svc.quiet_until(night, at(23)) == at(7) + timedelta(days=1)
    assert svc.quiet_until(night, at(3)) == at(7)
    assert svc.quiet_until(night, at(7)) is None and svc.quiet_until(night, at(12)) is None and svc.quiet_until(night, at(21)) is not None
    day = NotifyPrefs(user_id=1, quiet_from=time(13, 0), quiet_to=time(14, 30))
    assert svc.quiet_until(day, at(13, 10)) == at(14, 30) and svc.quiet_until(day, at(14, 30)) is None and svc.quiet_until(day, at(9)) is None
    assert svc.quiet_until(NotifyPrefs(user_id=1, quiet_from=time(9), quiet_to=time(9)), at(9)) is None
    assert svc.quiet_until(NotifyPrefs(user_id=1), at(9)) is None


def test_too_many_in_an_hour_hold_back_push_but_never_the_inbox(client, as_user, sql, monkeypatch):
    monkeypatch.setenv("NOTIFY_MAX_PER_USER_PER_HOUR", "2")
    get_settings.cache_clear()
    gm = as_user("GM01")
    subscribe(client, as_user("SO01"))
    got = [send(client, gm, title=f"T: flood {i}").json()["deliveries"] for i in range(4)]
    ok, held = {"inapp:stored": 1, "webpush:queued": 1}, {"inapp:stored": 1, "push:skipped": 1}
    assert got == [ok, ok, held, held]
    assert sql("select count(*) from public.notifications where title like 'T: flood %'").scalar() == 4      # all four are under the bell
    assert send(client, gm, title="T: flood urgent", priority=1).json()["deliveries"] == ok                    # urgent ones always go
    assert send(client, gm, to=[SO02], title="T: flood other").json()["deliveries"] == {"inapp:stored": 1}      # the limit is per person
    assert "too many" in sql("select last_error from platform.deliveries where status = 'skipped' limit 1").scalar()
    # the hour passes for the two that were really pushed: the held-back ones do not keep the person blocked
    sql("update platform.deliveries set created_at = now() - interval '2 hours' where channel = 'webpush'")
    assert send(client, gm, title="T: flood later").json()["deliveries"] == ok


# ---------- the queue ----------
def test_accepted_is_not_confirmed_until_the_device_says_so(client, as_user, sql, sender, db):
    subscribe(client, as_user("SO01"))
    n = send(client, as_user("GM01"), title="T: order approved", url="/orders", category="orders").json()
    assert n["deliveries"] == {"inapp:stored": 1, "webpush:queued": 1}
    assert svc.process_due(db) == {"accepted": 1, "failed": 0, "dead": 0, "expired": 0, "gone": 0}
    d = deliveries(sql, n["id"], "webpush")[0]
    assert d["status"] == "accepted" and d["provider_status"] == 201 and d["attempts"] == 1 and d["confirmed_at"] is None
    call = sender["calls"][0]
    assert call["payload"]["title"] == "T: order approved" and call["payload"]["url"] == "/orders" and 0 < call["ttl"] <= 86400 and call["urgent"] is False
    assert set(call["payload"]) == {"id", "title", "body", "url", "icon", "category", "ack"}     # nothing else travels in a push
    assert svc.process_due(db)["accepted"] == 0 and len(sender["calls"]) == 1                    # sent once
    tok = call["payload"]["ack"]
    assert client.post(f"{N}/ack", json={"token": tok[:-2] + "xx"}).json() == {"ok": False}
    assert client.post(f"{N}/ack", json={"token": f"{d['id'] + 1}.{tok.split('.')[1]}"}).json() == {"ok": False}   # a token is good for its own delivery only
    assert client.post(f"{N}/ack", json={"token": "nonsense"}).json() == {"ok": False}
    assert deliveries(sql, n["id"], "webpush")[0]["status"] == "accepted"
    assert client.post(f"{N}/ack", json={"token": tok}).json() == {"ok": True}                    # the service worker, no login needed
    d = deliveries(sql, n["id"], "webpush")[0]
    assert d["status"] == "confirmed" and d["confirmed_at"] is not None and d["clicked_at"] is None
    client.post(f"{N}/ack", json={"token": tok, "clicked": True})
    d2 = deliveries(sql, n["id"], "webpush")[0]
    assert d2["clicked_at"] is not None and d2["confirmed_at"] == d["confirmed_at"]
    detail = client.get(f"{N}/{n['id']}", headers=as_user("GM01")).json()
    assert detail["deliveries"] == {"inapp:stored": 1, "webpush:confirmed": 1} and {a["channel"] for a in detail["attempts"]} == {"inapp", "webpush"}


def test_retry_with_backoff_then_give_up(client, as_user, sql, sender, db, monkeypatch):
    monkeypatch.setenv("NOTIFY_MAX_ATTEMPTS", "3")
    get_settings.cache_clear()
    subscribe(client, as_user("SO01"))
    n = send(client, as_user("GM01")).json()
    sender["result"] = Result(ok=False, status=503, retry=True, error="push service answered 503")
    waits = []
    for attempt in (1, 2):
        assert svc.process_due(db)["failed"] == 1
        d = deliveries(sql, n["id"], "webpush")[0]
        assert d["status"] == "failed" and d["attempts"] == attempt and d["provider_status"] == 503
        waits.append((d["next_attempt_at"] - datetime.now(UTC)).total_seconds())
        assert svc.process_due(db)["failed"] == 0            # not before its time
        sql("update platform.deliveries set next_attempt_at = now() where channel = 'webpush'")
    assert 14 <= waits[0] <= 46 and 29 <= waits[1] <= 91      # 30 s then 60 s, each with jitter
    assert svc.process_due(db)["dead"] == 1                   # the third failure is the last
    d = deliveries(sql, n["id"], "webpush")[0]
    assert d["status"] == "dead" and d["attempts"] == 3 and len(sender["calls"]) == 3
    assert sql("select failures, active from platform.push_subscriptions").one() == (3, True)
    # an administrator can queue it again
    assert client.post(f"{N}/{n['id']}/retry", headers=as_user("GM01")).status_code == 403
    assert client.post(f"{N}/{n['id']}/retry", headers=as_user("ADMIN")).json() == {"requeued": 1}
    sender["result"] = Result(ok=True, status=201)
    assert svc.process_due(db)["accepted"] == 1
    assert sql("select failures from platform.push_subscriptions").scalar() == 0


def test_retry_after_from_the_push_service_is_respected(client, as_user, sql, sender, db):
    subscribe(client, as_user("SO01"))
    n = send(client, as_user("GM01")).json()
    sender["result"] = Result(ok=False, status=429, retry=True, retry_after=900, error="push service answered 429")
    svc.process_due(db)
    wait = (deliveries(sql, n["id"], "webpush")[0]["next_attempt_at"] - datetime.now(UTC)).total_seconds()
    assert 890 <= wait <= 905


def test_a_gone_subscription_is_switched_off(client, as_user, sql, sender, db):
    subscribe(client, as_user("SO01"))
    gm = as_user("GM01")
    n = send(client, gm).json()
    sender["result"] = Result(ok=False, status=410, gone=True, error="subscription no longer valid")
    assert svc.process_due(db)["gone"] == 1
    assert deliveries(sql, n["id"], "webpush")[0]["status"] == "dead"
    assert sql("select active, revoked_reason from platform.push_subscriptions").one() == (False, "subscription no longer valid")
    assert send(client, gm).json()["deliveries"] == {"inapp:stored": 1}       # it is not tried again
    assert len(sender["calls"]) == 1


def test_refused_without_retry_is_dead_at_once(client, as_user, sql, sender, db):
    subscribe(client, as_user("SO01"))
    n = send(client, as_user("GM01")).json()
    sender["result"] = Result(ok=False, status=400, error="push service refused it (400)")
    assert svc.process_due(db)["dead"] == 1 and deliveries(sql, n["id"], "webpush")[0]["attempts"] == 1


def test_a_crashing_sender_does_not_stop_the_queue(client, as_user, sql, sender, db):
    a, _ = subscribe(client, as_user("SO01"), Browser("one"))
    subscribe(client, as_user("SO02"), Browser("two"))
    n = send(client, as_user("GM01"), to=[SO01, SO02]).json()

    def flaky(sub, payload):
        if sub.endpoint == a.endpoint:
            raise RuntimeError("boom")
        return Result(ok=True, status=201)
    sender["result"] = flaky
    out = svc.process_due(db)
    assert out["accepted"] == 1 and out["failed"] == 1
    assert sorted(d["status"] for d in deliveries(sql, n["id"], "webpush")) == ["accepted", "failed"]
    assert "boom" not in (sql("select last_error from platform.deliveries where status = 'failed'").scalar() or "")


def test_expired_and_cancelled_are_not_sent(client, as_user, sql, sender, db):
    subscribe(client, as_user("SO01"))
    gm = as_user("GM01")
    old = send(client, gm, title="T: old").json()
    gone = send(client, gm, title="T: withdrawn").json()
    sql("update platform.notifications set expires_at = now() - interval '1 minute' where id = cast(:i as uuid)", i=old["id"])
    assert client.post(f"{N}/{gone['id']}/cancel", headers=gm).json() == {"status": "done", "withdrawn": 1}
    assert svc.process_due(db)["expired"] == 1 and sender["calls"] == []
    assert deliveries(sql, old["id"], "webpush")[0]["status"] == "expired" and deliveries(sql, gone["id"], "webpush")[0]["status"] == "skipped"


def test_a_batch_is_claimed_by_one_worker_only_and_stuck_work_returns(client, as_user, sql, sender, db):
    for i in range(3):
        subscribe(client, as_user("SO01"), Browser(f"dev{i}"))
    n = send(client, as_user("GM01")).json()
    from app.db import session_factory
    with session_factory()() as other:
        first = svc.claim_due(db, 2)
        second = svc.claim_due(other, 10)
        third = svc.claim_due(other, 10)
    assert len(first) == 2 and len(second) == 1 and third == [] and not set(first) & set(second)
    assert {d["status"] for d in deliveries(sql, n["id"], "webpush")} == {"processing"}
    assert svc.recover_stuck(db) == 0                           # they may still be in hand
    sql("update platform.deliveries set updated_at = now() - interval '10 minutes' where status = 'processing'")
    assert svc.recover_stuck(db) == 3
    db.commit()
    assert svc.process_due(db)["accepted"] == 3


def test_a_removed_device_is_dead_not_sent(client, as_user, sql, sender, db):
    subscribe(client, as_user("SO01"))
    n = send(client, as_user("GM01")).json()
    sid = sql("select id from platform.push_subscriptions").scalar()
    assert client.post(f"/api/v1/admin/push/subscriptions/{sid}/disable", headers=as_user("GM01")).status_code == 403
    assert client.post(f"/api/v1/admin/push/subscriptions/{sid}/disable", headers=as_user("ADMIN")).json() == {"ok": True}
    assert svc.process_due(db)["dead"] == 1 and sender["calls"] == []
    assert "no longer registered" in deliveries(sql, n["id"], "webpush")[0]["last_error"]


# ---------- the web app's own notifications ----------
def test_web_app_notifications_get_push_without_a_second_inbox_row(client, as_user, sql, sender, db):
    subscribe(client, as_user("SO01"))
    sql("insert into public.notifications(user_id, title, body, link) values (:u, 'T: history', 'old', '/orders')", u=SO01)
    assert svc.ingest_system(db) == 0                           # first run starts from now: history is not pushed
    db.commit()
    sql("insert into public.notifications(user_id, title, body, link) values (:u, 'T: order approved', 'ORD-1', '/orders'), (:v, 'T: booklet waiting', null, '/booklets')", u=SO01, v=SO02)
    manual = send(client, as_user("GM01"), title="T: manual").json()   # writes an inbox row marked 'engine'
    assert svc.ingest_system(db) == 2
    db.commit()
    assert svc.ingest_system(db) == 0                           # nothing is taken twice
    db.commit()
    made = sql("select title, source, category, url from platform.notifications where source = 'system' order by title").all()
    assert [tuple(m) for m in made] == [("T: booklet waiting", "system", "approvals", "/booklets"), ("T: order approved", "system", "orders", "/orders")]
    assert sql("select count(*) from public.notifications where title like 'T:%'").scalar() == 4      # history, two system, one manual: no copies
    assert svc.process_due(db)["accepted"] == 2                 # SO01: the system one and the manual one. SO02 has no device.
    assert sorted(c["payload"]["title"] for c in sender["calls"]) == ["T: manual", "T: order approved"]
    assert deliveries(sql, manual["id"], "webpush")[0]["status"] == "accepted"
    assert client.get(f"{N}?source=system", headers=as_user("GM01")).status_code == 403            # what the system sent is for whoever manages notifications
    hist = client.get(f"{N}?source=system", headers=as_user("ADMIN")).json()["notifications"]
    assert {h["title"] for h in hist} == {"T: booklet waiting", "T: order approved"}
    assert {h["title"] for h in client.get(N, headers=as_user("GM01")).json()["notifications"]} == {"T: manual"}


def test_worker_pass_does_the_whole_round(client, as_user, sql, sender):
    subscribe(client, as_user("SO01"))
    worker.tick()                                               # sets the starting point
    sql("insert into public.notifications(user_id, title, link) values (:u, 'T: from web', '/stock')", u=SO01)
    at = (datetime.now(UTC) + timedelta(hours=1)).isoformat()
    send(client, as_user("GM01"), title="T: scheduled", scheduled_at=at)
    sql("update platform.notifications set scheduled_at = now() - interval '1 second' where status = 'scheduled'")
    out = worker.tick()
    assert out["released"] == 1 and out["ingested"] == 1 and out["accepted"] == 2
    assert sorted(c["payload"]["title"] for c in sender["calls"]) == ["T: from web", "T: scheduled"]
    assert worker.tick()["accepted"] == 0


def test_queue_figures(client, as_user, sql, sender, db, vapid):
    subscribe(client, as_user("SO01"))
    send(client, as_user("GM01"))
    q = client.get("/api/v1/admin/notify/queue", headers=as_user("ADMIN")).json()
    assert q["last_7_days"] == {"stored": 1, "queued": 1} and q["subscriptions"] == {"webpush:active": 1} and q["channels"] == {"webpush": True, "apns": False} and q["oldest_due_seconds"] >= 0
    svc.process_due(db)
    assert client.get("/api/v1/admin/notify/queue", headers=as_user("ADMIN")).json()["last_7_days"] == {"stored": 1, "accepted": 1}


# ---------- the real Web Push protocol ----------
class FakeResponse:
    def __init__(self, status=201, headers=None, text=""):
        self.status_code, self.headers, self.text, self.reason = status, headers or {}, text, ""


@pytest.fixture()
def push_service(monkeypatch):
    """Stands where the browser vendor's push service would be and keeps exactly what the server posted to it."""
    import pywebpush
    box = {"requests": [], "answer": FakeResponse(201)}

    def post(url, data=None, headers=None, timeout=None, **kw):
        box["requests"].append({"url": url, "data": data, "headers": {k.lower(): v for k, v in (headers or {}).items()}, "timeout": timeout})
        return box["answer"]
    monkeypatch.setattr(pywebpush.requests, "post", post)
    return box


def test_web_push_is_encrypted_for_the_browser_and_signed_by_us(client, as_user, sql, db, vapid, push_service):
    br, _ = subscribe(client, as_user("SO01"))
    n = send(client, as_user("GM01"), title="T: Payment received", url="/r/collections", category="collections", priority=2).json()
    assert svc.process_due(db)["accepted"] == 1
    req = push_service["requests"][0]
    assert req["url"] == br.endpoint and req["timeout"] == 10
    h = req["headers"]
    assert h["content-encoding"] == "aes128gcm" and h["urgency"] == "high" and 0 < int(h["ttl"]) <= 86400
    # the body is unreadable on the way: the title is nowhere in it
    assert b"Payment" not in req["data"] and b"collections" not in req["data"]
    # only the browser's private key opens it
    msg = br.decrypt(req["data"])
    assert msg["title"] == "T: Payment received" and msg["url"] == "/r/collections" and msg["id"] == n["id"] and msg["ack"].split(".")[0].isdigit()
    with pytest.raises(Exception):  # noqa: B017  somebody else's key cannot
        Browser("other").decrypt(req["data"])
    # the push service can check the sender: a token signed with our private key, verifiable with the public one the browser subscribed with
    scheme, rest = h["authorization"].split(" ", 1)
    parts = dict(p.strip().split("=", 1) for p in rest.split(","))
    assert scheme == "vapid" and parts["k"] == vapid
    pub = ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), unb64(vapid))
    claims = jwt.decode(parts["t"], pub, algorithms=["ES256"], audience="https://fcm.googleapis.com")
    assert claims["sub"] == "mailto:it@everest.example" and claims["exp"] > datetime.now(UTC).timestamp()
    assert get_settings().vapid_private_key not in json.dumps(h)
    # the device answers that it showed it
    assert client.post(f"{N}/ack", json={"token": msg["ack"]}).json() == {"ok": True}
    assert deliveries(sql, n["id"], "webpush")[0]["status"] == "confirmed"


def test_web_push_answers_are_understood(client, as_user, sql, db, vapid, push_service):
    subscribe(client, as_user("SO01"))
    gm = as_user("GM01")
    a = send(client, gm, title="T: a").json()
    push_service["answer"] = FakeResponse(429, {"retry-after": "120"}, "slow down")
    assert svc.process_due(db)["failed"] == 1
    d = deliveries(sql, a["id"], "webpush")[0]
    assert d["provider_status"] == 429 and 110 <= (d["next_attempt_at"] - datetime.now(UTC)).total_seconds() <= 125
    sql("update platform.deliveries set next_attempt_at = now() where channel = 'webpush'")
    push_service["answer"] = FakeResponse(410, {}, "gone")
    assert svc.process_due(db)["gone"] == 1
    assert sql("select active from platform.push_subscriptions").scalar() is False


def test_garbage_keys_from_a_client_do_not_break_the_worker(client, as_user, sql, db, vapid, push_service):
    r = client.post(f"{P}/subscriptions", json={"channel": "webpush", "endpoint": "https://fcm.googleapis.com/fcm/send/bad", "keys": {"p256dh": "A" * 87, "auth": "B" * 22}}, headers=as_user("SO01"))
    assert r.status_code == 200
    n = send(client, as_user("GM01")).json()
    out = svc.process_due(db)
    assert out["accepted"] == 0 and push_service["requests"] == []
    assert deliveries(sql, n["id"], "webpush")[0]["status"] == "dead"
    assert sql("select active from platform.push_subscriptions").scalar() is False


def test_an_endpoint_outside_the_allowlist_is_never_called(sql, db, vapid, push_service):
    """Even a row written straight into the table cannot make the server call an internal address."""
    sql("insert into platform.push_subscriptions(user_id, channel, endpoint, p256dh, auth, failures, active) values (:u, 'webpush', 'https://10.0.0.5/admin', 'x', 'y', 0, true)", u=SO01)
    svc.create(db, title="T: x", body=None, audience={"kind": "users", "ids": [SO01]})
    db.commit()
    assert svc.process_due(db)["gone"] == 1 and push_service["requests"] == []


# ---------- iPhone: straight to Apple ----------
class FakeApple:
    sent: list = []
    answer = (200, {}, None)

    def __init__(self, **kw):
        FakeApple.kw = kw

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def post(self, url, json=None, headers=None):
        FakeApple.sent.append({"url": url, "json": json, "headers": headers})
        status, hdrs, body = FakeApple.answer

        class R:
            status_code = status
            headers = {"content-type": "application/json", **hdrs} if body is not None else hdrs

            @staticmethod
            def json():
                return body
        return R()


@pytest.fixture()
def apple(monkeypatch):
    key = ec.generate_private_key(ec.SECP256R1())
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    for k, v in {"APNS_KEY": pem.replace("\n", "\\n"), "APNS_KEY_ID": "KEY1234567", "APNS_TEAM_ID": "TEAM123456", "APNS_TOPIC": "com.everestparenterals.sales"}.items():
        monkeypatch.setenv(k, v)
    get_settings.cache_clear()
    monkeypatch.setattr(push_senders, "_apns_token", None)
    monkeypatch.setattr(push_senders.httpx, "Client", FakeApple)
    FakeApple.sent, FakeApple.answer = [], (200, {}, None)
    return key.public_key()


def test_iphone_push_goes_directly_to_apple(client, as_user, sql, db, apple):
    so = as_user("SO01")
    token = "a1b2c3" * 10 + "abcd"
    assert client.get(f"{P}/config", headers=so).json()["apns"] == {"enabled": True}
    r = client.post(f"{P}/subscriptions", json={"channel": "apns", "endpoint": token, "app_version": "1.0.0"}, headers=so)
    assert r.status_code == 200
    n = send(client, as_user("GM01"), title="T: Order approved", url="/orders", category="orders", priority=1).json()
    assert n["deliveries"] == {"inapp:stored": 1, "apns:queued": 1}
    assert svc.process_due(db)["accepted"] == 1
    req = FakeApple.sent[0]
    assert req["url"] == f"https://api.push.apple.com/3/device/{token}" and FakeApple.kw["http2"] is True
    assert req["json"]["aps"]["alert"] == {"title": "T: Order approved", "body": "body text"} and req["json"]["url"] == "/orders"
    h = req["headers"]
    assert h["apns-topic"] == "com.everestparenterals.sales" and h["apns-push-type"] == "alert" and h["apns-priority"] == "10"
    tok = h["authorization"].split(" ", 1)[1]
    assert jwt.get_unverified_header(tok) == {"alg": "ES256", "kid": "KEY1234567", "typ": "JWT"}
    assert jwt.decode(tok, apple, algorithms=["ES256"])["iss"] == "TEAM123456"
    # Apple says the token is dead: stop using it
    send(client, as_user("GM01"), title="T: second")
    FakeApple.answer = (410, {}, {"reason": "Unregistered"})
    assert svc.process_due(db)["gone"] == 1
    assert sql("select active, revoked_reason from platform.push_subscriptions").one() == (False, "Apple: Unregistered")
    assert len({s["headers"]["authorization"] for s in FakeApple.sent}) == 1      # the provider token is reused, as Apple requires


def test_iphone_push_is_off_without_apple_credentials(client, as_user, sql, db):
    client.post(f"{P}/subscriptions", json={"channel": "apns", "endpoint": "ab12" * 16}, headers=as_user("SO01"))
    n = send(client, as_user("GM01")).json()
    assert svc.process_due(db)["dead"] == 1
    assert "not configured" in deliveries(sql, n["id"], "apns")[0]["last_error"]


def test_models_are_in_step_with_the_migration(db):
    for m in (Notification, Delivery, PushSubscription, NotifyPrefs):
        db.query(m).limit(1).all()


def test_chat_message_pushes_only_to_members_who_are_away(client, as_user, sql, sender, db):
    sql("delete from platform.chat_rooms")
    a, b = as_user("SO01"), as_user("SO02")
    room = client.post("/api/v1/chat/rooms", json={"user_ids": [SO02]}, headers=a).json()["id"]
    client.post(f"/api/v1/chat/rooms/{room}/messages", json={"text": "nobody has a device yet"}, headers=a)
    assert sql("select count(*) from platform.notifications").scalar() == 0          # no device registered: no row is made
    subscribe(client, b)
    inbox = sql("select count(*) from public.notifications").scalar()
    client.post(f"/api/v1/chat/rooms/{room}/messages", json={"text": "Stock aa gaya?", "client_id": "c1"}, headers=a)
    client.post(f"/api/v1/chat/rooms/{room}/messages", json={"text": "Stock aa gaya?", "client_id": "c1"}, headers=a)   # the same message resent
    assert svc.process_due(db)["accepted"] == 1
    p = sender["calls"][0]["payload"]
    assert p["body"] == "Stock aa gaya?" and p["category"] == "chat" and p["url"] == "/chat" and p["title"] == sql("select name from public.users where id = :i", i=SO01).scalar()
    assert sql("select count(*) from public.notifications").scalar() == inbox       # chat does not fill the bell
    client.put(f"{N}/preferences", json={"muted_categories": ["chat"]}, headers=b)
    client.post(f"/api/v1/chat/rooms/{room}/messages", json={"text": "muted now"}, headers=a)
    assert svc.process_due(db)["accepted"] == 0


def test_push_stops_when_the_login_on_that_device_ends(client, sql, sender, db):
    from tests.helpers import auth, login
    sql("delete from platform.rate_limits")
    t = login(client, "SO03").json()
    h = auth(t["access_token"])
    subscribe(client, h)
    gm = auth(login(client, "GM01").json()["access_token"])
    first = send(client, gm, to=[SO03], title="T: while logged in").json()
    assert first["deliveries"] == {"inapp:stored": 1, "webpush:queued": 1}
    # the login ends after the push was queued but before it is sent (logout elsewhere, an administrator, a password change ...)
    sql("update platform.sessions set revoked_at = now(), revoke_reason = 'admin' where user_id = :u and revoked_at is null", u=SO03)
    assert svc.process_due(db)["dead"] == 1 and sender["calls"] == []
    assert "login on that device has ended" in deliveries(sql, first["id"], "webpush")[0]["last_error"]
    assert sql("select active, revoked_reason from platform.push_subscriptions").one() == (False, "login ended")
    # logging in again on the same browser brings it back
    br = Browser()
    h2 = auth(login(client, "SO03").json()["access_token"])
    subscribe(client, h2, br)
    assert send(client, gm, to=[SO03], title="T: back").json()["deliveries"] == {"inapp:stored": 1, "webpush:queued": 1}
    # a password change moves the person's token version on: every older login is over, and so is push to those devices
    sql("update public.users set token_version = token_version + 1 where id = :u", u=SO03)
    try:
        assert send(client, gm, to=[SO03], title="T: after password change").json()["deliveries"] == {"inapp:stored": 1}
    finally:
        sql("update platform.sessions set revoked_at = now() where user_id = :u and revoked_at is null", u=SO03)


def test_pushes_wait_on_the_network_side_by_side_and_each_gets_its_own_result(client, as_user, sql, sender, db):
    import threading
    import time as clock
    browsers = [subscribe(client, as_user("SO01"), Browser(f"par{i}"))[0] for i in range(8)]
    n = send(client, as_user("GM01")).json()
    seen_threads = set()

    def slow(sub, payload):
        seen_threads.add(threading.get_ident())
        clock.sleep(0.25)
        i = int(sub.endpoint[-1])
        return Result(ok=True, status=201) if i % 3 else Result(ok=False, status=410, gone=True, error="subscription no longer valid") if i == 0 else Result(ok=False, status=503, retry=True, error="push service answered 503")
    sender["result"] = slow
    t = clock.perf_counter()
    out = svc.process_due(db)
    took = clock.perf_counter() - t
    assert out == {"accepted": 5, "failed": 2, "dead": 0, "expired": 0, "gone": 1}        # 0 gone; 3 and 6 will retry; the other five accepted
    assert took < 1.2 and len(seen_threads) > 1, took                                     # one after another would take two seconds
    by_endpoint = dict(sql("select s.endpoint, d.status from platform.deliveries d join platform.push_subscriptions s on s.id = d.subscription_id where d.notification_id = cast(:n as uuid)", n=n["id"]).all())
    assert by_endpoint == {b.endpoint: ("dead" if b.endpoint[-1] == "0" else "failed" if b.endpoint[-1] in "36" else "accepted") for b in browsers}   # no result landed on the wrong device
    assert sql("select count(*) from platform.push_subscriptions where not active").scalar() == 1


# ---------- found by an independent review ----------
def test_a_notification_that_cannot_be_delivered_never_blocks_the_rest(client, as_user, sql, db, sender):
    gm = as_user("GM01")
    subscribe(client, as_user("SO01"))
    worker.tick()
    # written straight into the table, the way a bug or an older version might leave it
    sql("insert into platform.notifications(id, title, category, audience, priority, status, source, scheduled_at) values (gen_random_uuid(), 'T: broken', 'general', '{\"kind\":\"area\"}', 5, 'scheduled', 'manual', now() - interval '1 minute')")
    good = send(client, gm, title="T: good", scheduled_at=(datetime.now(UTC) + timedelta(hours=1)).isoformat()).json()
    sql("update platform.notifications set scheduled_at = now() - interval '1 second' where id = cast(:i as uuid)", i=good["id"])
    sql("insert into public.notifications(user_id, title, link) values (:u, 'T: from web after', '/orders')", u=SO01)
    out = worker.tick()
    assert out["released"] == 1 and out["ingested"] == 1 and out["accepted"] == 2          # the broken one did not stop the round
    assert sql("select status from platform.notifications where title = 'T: broken'").scalar() == "cancelled"
    assert worker.tick()["released"] == 0                                                     # and it is not tried again every two seconds


def test_senders_see_and_withdraw_only_their_own(client, as_user, sql):
    sql("update public.roles set permissions = permissions || '[\"notify.send\"]'::jsonb where key = 'so'")
    try:
        so, gm, admin = as_user("SO01"), as_user("GM01"), as_user("ADMIN")
        mine = send(client, so, to=[SO02], title="T: from the officer").json()
        theirs = send(client, gm, to=[SO02], title="T: from the GM", scheduled_at=(datetime.now(UTC) + timedelta(hours=1)).isoformat()).json()
        assert [n["title"] for n in client.get(N, headers=so).json()["notifications"]] == ["T: from the officer"]
        assert client.get(f"{N}/{mine['id']}", headers=so).status_code == 200
        assert client.get(f"{N}/{theirs['id']}", headers=so).status_code == 404
        assert client.post(f"{N}/{theirs['id']}/cancel", headers=so).status_code == 404 and sql("select status from platform.notifications where title = 'T: from the GM'").scalar() == "scheduled"
        assert {n["title"] for n in client.get(N, headers=admin).json()["notifications"]} == {"T: from the officer", "T: from the GM"}     # whoever manages sees all
        assert client.post(f"{N}/{theirs['id']}/cancel", headers=admin).json()["status"] == "cancelled"
        # urgent, and long lists of names, are a broadcast in all but name
        assert send(client, so, to=[SO02], priority=1).status_code == 403
        assert send(client, so, to=list(range(1, 202))).status_code == 403 and send(client, gm, to=list(range(1, 202))).status_code == 200
    finally:
        sql("update public.roles set permissions = permissions - 'notify.send' where key = 'so'")


def test_what_was_said_in_chat_is_not_readable_from_notification_history(client, as_user, sql, sender, db):
    sql("delete from platform.chat_rooms")
    subscribe(client, as_user("SO02"))
    room = client.post("/api/v1/chat/rooms", json={"user_ids": [SO02]}, headers=as_user("SO01")).json()["id"]
    client.post(f"/api/v1/chat/rooms/{room}/messages", json={"text": "secret salary talk"}, headers=as_user("SO01"))
    assert svc.process_due(db)["accepted"] == 1 and sender["calls"][0]["payload"]["body"] == "secret salary talk"     # the member's own device gets it
    assert client.get(f"{N}?source=all", headers=as_user("GM01")).status_code == 403
    rows = client.get(f"{N}?source=system", headers=as_user("ADMIN")).json()["notifications"]
    assert len(rows) == 1 and rows[0]["title"] == "Chat message" and rows[0]["body"] is None and "salary" not in str(rows)
    assert "salary" not in client.get(f"{N}/{rows[0]['id']}", headers=as_user("ADMIN")).text


def test_what_was_queued_for_one_person_never_reaches_the_next_person_on_that_browser(client, as_user, sql, sender, db):
    so = as_user("SO01")
    br, sid = subscribe(client, so)
    client.put(f"{N}/preferences", json={"quiet_from": "00:00", "quiet_to": "23:59"}, headers=so)      # so the push waits
    n = send(client, as_user("GM01"), to=[SO01], title="T: private for SO01").json()
    assert n["deliveries"] == {"inapp:stored": 1, "webpush:queued": 1}
    subscribe(client, as_user("SO02"), br)                                                              # the session ended without a logout click; SO02 logs in
    d = deliveries(sql, n["id"], "webpush")[0]
    assert d["status"] == "skipped" and "another person" in d["last_error"]
    sql("update platform.deliveries set next_attempt_at = now()")
    assert svc.process_due(db)["accepted"] == 0 and sender["calls"] == []
    # and even if a row slipped through (changed straight in the table), the sender refuses it
    sql("update platform.deliveries set status = 'queued' where id = :i", i=d["id"])
    assert svc.process_due(db)["dead"] == 1 and sender["calls"] == []
    assert "another person" in deliveries(sql, n["id"], "webpush")[0]["last_error"]


def test_shown_on_device_is_not_overwritten_by_a_late_accepted(client, as_user, sql, sender, db):
    from app.db import session_factory
    for i in range(3):
        subscribe(client, as_user("SO01"), Browser(f"ack{i}"))
    n = send(client, as_user("GM01")).json()

    def answer(sub, payload):
        with session_factory()() as other:      # the device reports "shown" before the worker has recorded "accepted"
            assert svc.confirm(other, payload["ack"], False)
            other.commit()
        return Result(ok=True, status=201)
    sender["result"] = answer
    assert svc.process_due(db)["accepted"] == 3
    rows = deliveries(sql, n["id"], "webpush")
    assert [r["status"] for r in rows] == ["confirmed"] * 3 and all(r["confirmed_at"] and r["provider_status"] == 201 for r in rows)


def test_inbox_rows_saved_out_of_order_are_all_picked_up_and_an_old_position_marker_is_understood(sql, db, sender):
    assert svc.ingest_system(db) == 0
    db.commit()
    top = sql("select coalesce(max(id), 0) from public.notifications").scalar()
    sql("insert into public.notifications(id, user_id, title, link) values (:i, :u, 'T: later id, saved first', '/orders')", i=top + 50, u=SO01)
    assert svc.ingest_system(db) == 1
    db.commit()
    sql("insert into public.notifications(id, user_id, title, link) values (:i, :u, 'T: earlier id, saved late', '/orders')", i=top + 40, u=SO01)
    assert svc.ingest_system(db) == 1                              # a counter that only moves forward would have stepped over this one
    db.commit()
    assert svc.ingest_system(db) == 0
    db.commit()
    # an installation upgraded from the version that kept a position
    sql("insert into public.notifications(id, user_id, title, link) values (:i, :u, 'T: before upgrade', '/orders'), (:j, :u, 'T: after upgrade', '/orders')", i=top + 60, j=top + 70, u=SO01)
    sql("update platform.settings set value = :v where key = 'notify.inbox_cursor'", v=str(top + 60))
    assert svc.ingest_system(db) == 1
    db.commit()
    assert sql("select title from platform.notifications where source = 'system' order by created_at desc limit 1").scalar() == "T: after upgrade"
    assert sql("select count(*) from platform.notifications where title = 'T: before upgrade'").scalar() == 0


def test_a_long_message_in_nepali_fits_in_a_push(client, as_user, sql, db, vapid, push_service):
    br, _ = subscribe(client, as_user("SO01"))
    title, body = "सूचना " * 25, "भोलि डिपो बन्द रहनेछ। " * 23
    n = send(client, as_user("GM01"), title=title[:150], body=body[:500]).json()
    assert svc.process_due(db)["accepted"] == 1
    data = push_service["requests"][0]["data"]
    assert len(data) < 4000, len(data)                              # push services refuse more than about 4 KB
    msg = br.decrypt(data)
    assert msg["title"] == title[:150].strip() and msg["body"] == body[:500].strip() and msg["id"] == n["id"]


def test_a_subscription_made_with_an_older_server_key_is_dropped(client, as_user, sql, db, vapid, push_service):
    subscribe(client, as_user("SO01"))
    send(client, as_user("GM01"))
    push_service["answer"] = FakeResponse(403, {}, "the VAPID credentials in the authorization header do not correspond to the credentials used to create the subscriptions")
    assert svc.process_due(db)["gone"] == 1
    assert sql("select active, revoked_reason from platform.push_subscriptions").one() == (False, "made with an older server key")
