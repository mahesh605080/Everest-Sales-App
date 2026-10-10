"""Attacks that cut across the modules: forged tokens, cross-site requests, injection, floods, leaks.
Each module's own tests cover its access rules; these cover what an outsider would try first."""
import base64
import json
import logging
import time
import uuid
from datetime import UTC, datetime, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.config import get_settings
from app.main import create_app
from app.middleware import Flood
from app.services import jobs
from tests.helpers import PW, auth, login

V = "/api/v1"
SECRET = "test-secret-0123456789abcdef0123456789abcdef"
b64 = lambda d: base64.urlsafe_b64encode(json.dumps(d).encode()).decode().rstrip("=")  # noqa: E731


def forge(claims: dict, secret: str = SECRET, alg: str = "HS256") -> str:
    now = datetime.now(UTC)
    return jwt.encode({"iat": now, "exp": now + timedelta(minutes=10), "typ": "access", **claims}, secret, algorithm=alg)


# ---------- tokens ----------
def test_forged_and_borrowed_tokens_are_refused(client, sql):
    sql("delete from platform.rate_limits")
    so = login(client, "SO01").json()
    gm = login(client, "GM01").json()
    me = lambda t: client.get(f"{V}/auth/me", headers=auth(t)).status_code  # noqa: E731
    assert me(so["access_token"]) == 200
    unsigned = f"{b64({'alg': 'none', 'typ': 'JWT'})}.{b64({'uid': 1, 'tv': 0, 'exp': int(time.time()) + 600, 'iat': int(time.time())})}."
    assert me(unsigned) == 401                                                   # "no signature needed" is not accepted
    assert me(forge({"uid": 1, "tv": 0}, secret="some-other-secret-0123456789abcdef")) == 401
    head, body, sig = so["access_token"].split(".")
    claims = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
    assert me(f"{head}.{b64({**claims, 'uid': 1})}.{sig}") == 401                 # a changed body no longer matches the signature
    # Even a correctly signed token is not enough by itself:
    assert me(forge({"uid": 10, "tv": 999, "sid": so["session_id"]})) == 401     # wrong token version
    assert me(forge({"uid": 1, "tv": 0, "sid": so["session_id"]})) == 401        # another person's login id does not make you the Super Admin
    assert me(forge({"uid": 10, "tv": 0, "sid": gm["session_id"]})) == 401
    assert me(forge({"uid": 10, "tv": 0, "sid": str(uuid.uuid4())})) == 401      # a login that does not exist
    assert me(forge({"uid": 999999, "tv": 0})) == 401
    assert me(jwt.encode({"uid": 10, "tv": 0}, SECRET, algorithm="HS256")) == 401    # no expiry: refused
    assert me(forge({"uid": 10, "tv": 0, "exp": datetime.now(UTC) - timedelta(seconds=5)})) == 401
    assert me(so["refresh_token"]) == 401                                        # a refresh token is not an access token
    assert client.post(f"{V}/auth/refresh", json={"refresh_token": so["access_token"]}).status_code in (401, 422)
    assert me(so["access_token"]) == 200                                         # none of this harmed the real login


# ---------- cross-site requests ----------
@pytest.fixture()
def cookie(client, sql):
    """The cookie a browser holds after logging in through the web app."""
    sql("delete from platform.rate_limits")
    t = login(client, "GM01").json()
    yield {"cookie": f"sfa_session={t['access_token']}"}
    client.cookies.clear()


def test_a_cookie_only_works_for_changes_coming_from_our_own_pages(client, cookie, sql):
    body = {"push_enabled": True, "muted_categories": []}
    u = f"{V}/notifications/preferences"
    assert client.get(u, headers=cookie).status_code == 200                                       # reading is always allowed
    assert client.put(u, json=body, headers={**cookie, "origin": "https://evil.example"}).status_code == 403
    assert client.put(u, json=body, headers={**cookie, "origin": "http://testserver.evil.example"}).status_code == 403
    assert client.put(u, json=body, headers={**cookie, "origin": "null"}).status_code == 403
    assert client.put(u, json=body, headers={**cookie, "sec-fetch-site": "cross-site"}).status_code == 403    # no Origin, but the browser says it is foreign
    assert client.put(u, json=body, headers={**cookie, "origin": "http://testserver"}).status_code == 200
    assert client.put(u, json=body, headers={**cookie, "sec-fetch-site": "same-origin"}).status_code == 200
    r = client.put(u, json=body, headers={**cookie, "origin": "https://evil.example"})
    assert r.json()["code"] == "bad_origin" and "access-control-allow-origin" not in r.headers


def test_other_sites_get_no_cors_permission(client):
    r = client.options(f"{V}/auth/me", headers={"origin": "https://evil.example", "access-control-request-method": "GET", "access-control-request-headers": "authorization"})
    assert "access-control-allow-origin" not in r.headers
    r = client.get(f"{V}/health", headers={"origin": "https://evil.example"})
    assert "access-control-allow-origin" not in r.headers and "access-control-allow-credentials" not in r.headers


def test_the_live_connection_needs_a_login_and_ignores_a_cookie_from_another_site(client, cookie):
    with pytest.raises(WebSocketDisconnect) as e, client.websocket_connect("/ws") as ws:
        ws.send_json({"type": "subscribe", "channel": "all"})
        ws.receive_json()
    assert e.value.code == 4401
    with pytest.raises(WebSocketDisconnect) as e, client.websocket_connect("/ws", headers={**cookie, "origin": "https://evil.example"}) as ws:
        ws.send_json({"type": "ping"})
        ws.receive_json()
    assert e.value.code == 4401
    with client.websocket_connect("/ws", headers={**cookie, "origin": "http://testserver"}) as ws:
        assert ws.receive_json()["type"] == "ready"


# ---------- injection ----------
INJECT = ["' or '1'='1", "'; drop table public.users; --", "1; select pg_sleep(10)", "\" or \"\"=\"", "%' union select password_hash from users --", "../../etc/passwd", "${jndi:ldap://x}", "\x00", "{{7*7}}", "<script>alert(1)</script>"]


def test_hostile_text_is_only_ever_data(client, as_user, sql):
    so, admin = as_user("SO01"), as_user("ADMIN")
    users = sql("select count(*) from public.users").scalar()
    for x in INJECT:
        for url, h in [(f"{V}/chat/people", so), (f"{V}/files", so), (f"{V}/admin/login-events", admin), (f"{V}/admin/jobs", admin)]:
            param = "outcome" if "login-events" in url else "kind" if "jobs" in url else "q"
            r = client.get(url, params={param: x}, headers=h)
            assert r.status_code in (200, 422), (url, x, r.status_code)
        assert client.get(f"{V}/realtime/events", params={"channel": x}, headers=so).status_code == 403
        if "\x00" not in x:   # a zero byte cannot even be put in an address
            assert client.get(f"{V}/admin/db/tables/public/{x.replace('/', '%2F')}", headers=admin).status_code in (404, 422)
            assert client.get(f"{V}/admin/db/tables/{x.replace('/', '%2F')}/users", headers=admin).status_code in (404, 422)
        assert client.post(f"{V}/auth/login", json={"login": x, "password": x}).status_code in (401, 422, 429)
        assert client.post(f"{V}/admin/jobs", json={"kind": x}, headers=admin).status_code == 422
        assert client.post(f"{V}/notifications", json={"title": "t", "audience": {"kind": "role", "key": x}}, headers=admin).status_code in (200, 422)
    assert sql("select count(*) from public.users").scalar() == users and sql("select to_regclass('public.users')").scalar() == "users"
    sql("delete from platform.notifications where title = 't'")


def test_text_with_markup_is_stored_as_text_and_sent_back_as_json(client, as_user, sql):
    sql("delete from platform.chat_rooms")
    evil = "<img src=x onerror=alert(1)>"
    room = client.post(f"{V}/chat/rooms", json={"user_ids": [11]}, headers=as_user("SO01")).json()["id"]
    r = client.post(f"{V}/chat/rooms/{room}/messages", json={"text": evil}, headers=as_user("SO01"))
    assert r.json()["text"] == evil and r.headers["content-type"].startswith("application/json") and r.headers["x-content-type-options"] == "nosniff"


# ---------- floods ----------
def test_flood_ceiling_per_address(monkeypatch):
    monkeypatch.setenv("RATE_LIMIT_PER_MINUTE", "5")
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            a = {"x-forwarded-for": "203.0.113.9"}
            assert [c.get(f"{V}/auth/me", headers=a).status_code for _ in range(5)] == [401] * 5
            r = c.get(f"{V}/auth/me", headers=a)
            assert r.status_code == 429 and r.json()["code"] == "rate_limited" and r.headers["retry-after"] == "60" and r.headers["x-request-id"]
            assert c.get(f"{V}/auth/me", headers={"x-forwarded-for": "203.0.113.10"}).status_code == 401      # another address is not affected
            assert c.get(f"{V}/auth/me", headers={"x-forwarded-for": "203.0.113.10, 203.0.113.9"}).status_code == 429   # the address our proxy saw is the one that counts
            assert c.get(f"{V}/health", headers=a).status_code == 200                                       # the bare "alive" answer is never limited
            assert c.get(f"{V}/health/ready", headers=a).status_code == 429                                 # the one that asks the database is
            v6 = [c.get(f"{V}/auth/me", headers={"x-forwarded-for": f"2001:db8:1:2::{i:x}"}).status_code for i in range(1, 8)]
            assert v6 == [401] * 5 + [429] * 2                                                              # one IPv6 customer cannot hop between its own addresses
    finally:
        get_settings.cache_clear()


def test_flood_counter_cannot_fill_the_memory():
    f = Flood(per_minute=2, max_keys=100)
    for i in range(500):
        f.allow(f"10.0.{i // 250}.{i % 250}")
    assert len(f.counts) <= 101
    assert Flood(0).allow("x") and Flood(0).allow("x") and Flood(0).allow("x")


def test_a_person_cannot_flood_chat_or_notifications(client, as_user, sql):
    sql("delete from platform.chat_rooms")
    so, admin = as_user("SO01"), as_user("ADMIN")
    room = client.post(f"{V}/chat/rooms", json={"user_ids": [11]}, headers=so).json()["id"]
    codes = [client.post(f"{V}/chat/rooms/{room}/messages", json={"text": f"m{i}"}, headers=so).status_code for i in range(62)]
    assert codes[:60] == [201] * 60 and codes[60:] == [429, 429]
    assert client.post(f"{V}/chat/rooms/{room}/messages", json={"text": "other person"}, headers=as_user("SO02")).status_code == 201
    codes = [client.post(f"{V}/notifications", json={"title": f"flood {i}", "audience": {"kind": "users", "ids": [10]}}, headers=admin).status_code for i in range(32)]
    assert codes[:30] == [200] * 30 and codes[30:] == [429, 429]
    sql("delete from platform.notifications where title like 'flood %'")
    sql("delete from public.notifications where title like 'flood %'")
    sql("delete from platform.rate_limits")


def test_a_nonsense_length_header_is_refused_not_crashed(client):
    r = client.post(f"{V}/auth/login", content=b"{}", headers={"content-length": "abc", "content-type": "application/json"})
    assert r.status_code in (400, 413)


# ---------- leaks ----------
def test_a_crash_tells_the_caller_nothing_and_the_log_everything(as_user, monkeypatch):
    from app.routers import notify as router

    def boom(*a, **k):
        raise RuntimeError("secret internal detail: table users column password_hash")
    monkeypatch.setattr(router.svc, "prefs_of", boom)
    seen: list[logging.LogRecord] = []

    class Keep(logging.Handler):
        def emit(self, record):
            seen.append(record)
    h = as_user("SO01")
    with TestClient(create_app(), raise_server_exceptions=False) as c:
        keep = Keep()
        logging.getLogger("platform").addHandler(keep)
        try:
            r = c.get(f"{V}/notifications/preferences", headers=h)
        finally:
            logging.getLogger("platform").removeHandler(keep)
    assert r.status_code == 500 and r.json()["code"] == "server_error" and r.json()["request_id"]
    assert "secret internal" not in r.text and "Traceback" not in r.text and "password_hash" not in r.text
    crash = [rec for rec in seen if rec.getMessage() == "unhandled error"]
    assert len(crash) == 1 and crash[0].exc_info and crash[0].request_id == r.json()["request_id"]     # the id the person can quote finds the cause in the log


def test_passwords_and_tokens_never_reach_the_log(client, sql, caplog):
    sql("delete from platform.rate_limits")
    with caplog.at_level(logging.DEBUG):
        t = login(client, "SO02").json()
        login(client, "SO02", pw="Wrong-Passw0rd-xyz")
        client.post(f"{V}/auth/refresh", json={"refresh_token": t["refresh_token"]})
        client.get(f"{V}/auth/me", headers=auth(t["access_token"]))
        client.post(f"{V}/auth/password", json={"current": "Wrong-Current-9", "new": "Brand-New-Passw0rd"}, headers=auth(t["access_token"]))
    text = "\n".join(rec.getMessage() + " " + json.dumps({k: str(v) for k, v in rec.__dict__.items()}) for rec in caplog.records)
    assert len(caplog.records) > 3
    for secret in (PW, "Wrong-Passw0rd-xyz", "Brand-New-Passw0rd", "Wrong-Current-9", t["refresh_token"], t["access_token"], SECRET):
        assert secret not in text


def test_the_database_view_masks_every_secret_column(client, as_user, sql):
    admin = as_user("ADMIN")
    sql("delete from platform.rate_limits")
    login(client, "SO01")
    for schema, table, hidden in [("public", "users", "password_hash"), ("platform", "refresh_tokens", "token_hash"), ("platform", "password_resets", "token_hash"), ("platform", "push_subscriptions", "p256dh"),
                                  ("platform", "push_subscriptions", "auth"), ("platform", "push_subscriptions", "endpoint")]:
        d = client.get(f"{V}/admin/db/tables/{schema}/{table}", headers=admin).json()
        col = next(c for c in d["columns"] if c["column_name"] == hidden)
        assert col["hidden"] is True and all(hidden not in r or r[hidden] in (None, "•••", "***", "[hidden]") for r in d["rows"]), (table, hidden, d["rows"][:1])
    assert "$argon2" not in client.get(f"{V}/admin/db/tables/public/users", headers=admin).text


def test_the_interactive_api_pages_are_off_in_production(monkeypatch):
    monkeypatch.setenv("PLATFORM_ENV", "production")
    get_settings.cache_clear()
    try:
        with TestClient(create_app()) as c:
            assert c.get(f"{V}/docs").status_code == 404 and c.get("/docs").status_code == 404 and c.get("/redoc").status_code == 404
            assert c.get(f"{V}/health").json()["env"] == "production"
    finally:
        monkeypatch.setenv("PLATFORM_ENV", "test")
        get_settings.cache_clear()


# ---------- idle browser logins ----------
def test_a_browser_login_left_unused_is_ended_and_a_phone_login_is_not(sql, db):
    ids = {k: str(uuid.uuid4()) for k in ("web_idle", "web_active", "phone_idle")}
    q = "insert into platform.sessions(id, user_id, client, token_version, created_at, last_used_at, expires_at) values (cast(:i as uuid), 12, :c, 0, now() - interval '20 days', {u}, now() + interval '10 days')"
    sql(q.format(u="now() - interval '9 days'"), i=ids["web_idle"], c="web")
    sql(q.format(u="now() - interval '1 day'"), i=ids["web_active"], c="web")
    sql(q.format(u="now() - interval '9 days'"), i=ids["phone_idle"], c="android")
    jobs.enqueue(db, "auth.cleanup")
    db.commit()
    assert jobs.run_one(db)["status"] == "done"
    got = dict(sql("select id::text, revoke_reason from platform.sessions where id = any(cast(:i as uuid[]))", i=list(ids.values())).all())
    assert got == {ids["web_idle"]: "idle", ids["web_active"]: None, ids["phone_idle"]: None}
    sql("delete from platform.sessions where id = any(cast(:i as uuid[]))", i=list(ids.values()))
    sql("delete from platform.jobs")


def test_nobody_can_send_a_huge_body_to_any_address_before_logging_in(client):
    big = b"x" * (3 * 1024 * 1024)
    for method, path in [("PUT", f"{V}/files/1/shares"), ("PATCH", f"{V}/files/1"), ("POST", f"{V}/files/1/link"), ("POST", f"{V}/auth/login"), ("POST", f"{V}/notifications/ack")]:
        r = client.request(method, path, content=big, headers={"content-type": "application/json"})
        assert r.status_code == 413, (method, path, r.status_code)

        def chunks():
            for _ in range(48):
                yield b"y" * 65536
        r = client.request(method, path, content=chunks(), headers={"content-type": "application/json"})    # no length announced: stopped while reading
        assert r.status_code in (400, 413), (method, path, r.status_code)
    # the one address meant for uploads takes a file's worth, and still not more
    huge = b"z" * (get_settings().file_max_bytes + 200_000)
    assert client.post(f"{V}/files", content=huge, headers={"content-type": "multipart/form-data; boundary=x"}).status_code == 413
