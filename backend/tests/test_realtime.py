import json
import time

import pytest
from sqlalchemy import text
from starlette.websockets import WebSocketDisconnect

from app.db import session_factory
from app.realtime import hub as hubmod
from tests.helpers import login

R = "/api/v1"


def tok(client, code):
    return login(client, code).json()


def connect(client, access):
    ws = client.websocket_connect("/ws")
    s = ws.__enter__()
    s.send_json({"type": "auth", "token": access})
    ready = s.receive_json()
    assert ready["type"] == "ready", ready
    return ws, s, ready


def until(s, pred, limit=40):
    """Read messages until one matches. The test timeout stops a wait for something that never comes."""
    seen = []
    for _ in range(limit):
        m = s.receive_json()
        seen.append(m)
        if pred(m):
            return m, seen
    raise AssertionError(f"not received; saw {seen}")


def emit_elsewhere(channel, type_, payload, commit=True, key=None):
    """Writes an event on a separate database connection, the way the web app does."""
    db = session_factory()()
    try:
        eid = db.execute(text("insert into platform.events(channel, type, payload, dedupe_key) values (:c, :t, cast(:p as jsonb), :k) on conflict (dedupe_key) do nothing returning id"),
                         {"c": channel, "t": type_, "p": json.dumps(payload), "k": key}).scalar()
        db.commit() if commit else db.rollback()
        return eid
    finally:
        db.close()


@pytest.fixture(autouse=True)
def fresh(sql):
    sql("delete from platform.rate_limits")
    sql("delete from platform.chat_rooms")
    sql("update public.users set active = true, failed_logins = 0, locked_until = null")
    yield


def uid(sql, code):
    return sql("select id from public.users where code = :c", c=code).scalar()


# ---------- connecting ----------
def test_socket_needs_a_valid_token(client):
    with client.websocket_connect("/ws") as s:
        s.send_json({"type": "auth", "token": "not.a.token"})
        with pytest.raises(WebSocketDisconnect) as e:
            s.receive_json()
        assert e.value.code == 4401
    with client.websocket_connect("/ws") as s:
        s.send_json({"type": "subscribe", "channel": "all"})  # anything but auth first
        with pytest.raises(WebSocketDisconnect) as e:
            s.receive_json()
        assert e.value.code == 4401


def test_browser_cookie_is_accepted_only_from_our_own_pages(client, sql):
    t = tok(client, "SO01")
    client.cookies.set("sfa_session", t["access_token"])
    with client.websocket_connect("/ws", headers={"origin": "http://testserver"}) as s:
        assert s.receive_json()["type"] == "ready"
    with client.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as s:
        s.send_json({"type": "ping"})
        with pytest.raises(WebSocketDisconnect):  # the cookie is ignored for a foreign page, so it is asked to authenticate and refused
            s.receive_json()
    client.cookies.clear()


def test_ping_and_unknown_messages(client):
    ws, s, ready = connect(client, tok(client, "SO01")["access_token"])
    assert ready["heartbeat_seconds"] == 25 and "all" in ready["channels"]
    s.send_json({"type": "ping"})
    assert s.receive_json() == {"type": "pong"}
    s.send_text("not json")
    assert s.receive_json()["code"] == "bad_message"
    s.send_json({"type": "launch", "ref": 7})
    m = s.receive_json()
    assert m["code"] == "unknown_type" and m["ref"] == 7
    s.send_text(json.dumps({"type": "ping", "pad": "x" * 9000}))
    assert s.receive_json()["code"] == "too_large"
    ws.__exit__(None, None, None)


# ---------- events ----------
def test_committed_event_from_another_process_arrives_and_a_rolled_back_one_does_not(client, sql):
    me = uid(sql, "SO01")
    ws, s, _ = connect(client, tok(client, "SO01")["access_token"])
    emit_elsewhere(f"user:{me}", "order.approved", {"no": "SO-ROLLED-BACK"}, commit=False)
    eid = emit_elsewhere(f"user:{me}", "order.approved", {"no": "SO-1"})
    m, seen = until(s, lambda m: m["type"] == "event")
    assert m["id"] == eid and m["event"] == "order.approved" and m["payload"] == {"no": "SO-1"} and m["channel"] == f"user:{me}"
    assert all(x.get("payload", {}).get("no") != "SO-ROLLED-BACK" for x in seen)
    ws.__exit__(None, None, None)


def test_events_reach_only_their_audience(client, sql):
    a_id, b_id = uid(sql, "SO01"), uid(sql, "SO02")
    wa, a, _ = connect(client, tok(client, "SO01")["access_token"])
    wb, b, _ = connect(client, tok(client, "SO02")["access_token"])
    emit_elsewhere(f"user:{b_id}", "private", {"for": "b"})
    emit_elsewhere("all", "announcement", {"text": "office closed tomorrow"})
    mb, seen_b = until(b, lambda m: m.get("event") == "announcement")
    ma, seen_a = until(a, lambda m: m.get("event") == "announcement")
    assert any(x.get("event") == "private" for x in seen_b) and not any(x.get("event") == "private" for x in seen_a)
    assert ma["id"] == mb["id"] and a_id != b_id
    wa.__exit__(None, None, None)
    wb.__exit__(None, None, None)


def test_subscription_rules(client, sql):
    other = uid(sql, "SO02")
    region = sql("select region_id from public.users where code = 'RSM01'").scalar()
    area = sql("select area_id from public.users where code = 'SO01'").scalar()
    foreign_area = sql("select id from public.areas where region_id <> :r limit 1", r=region).scalar()
    ws, s, _ = connect(client, tok(client, "SO01")["access_token"])

    def sub(ch):
        s.send_json({"type": "subscribe", "channel": ch, "ref": ch})
        m, _ = until(s, lambda m: m.get("ref") == ch)
        return m["type"]
    assert sub(f"user:{other}") == "error" and sub("role:gm") == "error" and sub("anything") == "error" and sub("user:1;drop") == "error" and sub("data:nope") == "error"
    assert sub("role:so") == "subscribed" and sub(f"area:{area}") == "subscribed" and sub(f"area:{foreign_area}") == "error"
    ws.__exit__(None, None, None)
    ws, s, _ = connect(client, tok(client, "GM01")["access_token"])
    assert sub(f"area:{foreign_area}") == "subscribed" and sub(f"region:{region}") == "subscribed" and sub(f"user:{other}") == "error"  # even a GM cannot read a private channel
    ws.__exit__(None, None, None)


def test_reconnect_gets_missed_events_once_and_in_order(client, sql):
    me = uid(sql, "SO03")
    access = tok(client, "SO03")["access_token"]
    ws, s, _ = connect(client, access)
    first = emit_elsewhere(f"user:{me}", "n", {"i": 1})
    until(s, lambda m: m.get("id") == first)
    ws.__exit__(None, None, None)  # the phone goes into a tunnel
    missed = [emit_elsewhere(f"user:{me}", "n", {"i": i}) for i in (2, 3, 4)]
    ws, s, _ = connect(client, access)
    s.send_json({"type": "subscribe", "channel": f"user:{me}", "since": first, "ref": "r"})
    live = emit_elsewhere(f"user:{me}", "n", {"i": 5})
    got = []
    while len(got) < 4:
        m = s.receive_json()
        if m["type"] == "event":
            got.append(m["id"])
    assert got == [*missed, live]  # nothing lost, nothing twice, in order
    s.send_json({"type": "ping"})
    assert s.receive_json() == {"type": "pong"}  # and nothing else is queued behind them
    ws.__exit__(None, None, None)
    # the same catch-up is available to a client that polls
    r = client.get(f"{R}/realtime/events?channel=user:{me}&since={first}", headers={"authorization": f"Bearer {access}"}).json()
    assert [e["id"] for e in r["events"]] == [*missed, live] and r["last_event_id"] >= live
    assert client.get(f"{R}/realtime/events?channel=user:{uid(sql, 'SO01')}", headers={"authorization": f"Bearer {access}"}).status_code == 403


def test_the_same_event_key_is_stored_once(sql):
    a = emit_elsewhere("all", "x", {}, key="once-1")
    b = emit_elsewhere("all", "x", {}, key="once-1")
    assert a is not None and b is None


def test_event_ids_commit_in_order(sql):
    """Two writers at once: the second waits for the first to commit, so a lower id can never appear after a higher one."""
    one, two = session_factory()(), session_factory()()
    try:
        one.execute(text("insert into platform.events(channel, type) values ('all', 'a')"))
        two.execute(text("set local lock_timeout = '300ms'"))
        with pytest.raises(Exception, match="lock timeout"):
            two.execute(text("insert into platform.events(channel, type) values ('all', 'b')"))
        two.rollback()
        one.commit()
        two.execute(text("insert into platform.events(channel, type) values ('all', 'b')"))
        two.commit()
    finally:
        one.close()
        two.close()


def test_publish_is_for_the_super_admin(client, as_user):
    assert client.post(f"{R}/realtime/publish", json={"channel": "all", "event": "notice.new", "payload": {"t": 1}}, headers=as_user("GM01")).status_code == 403
    assert client.post(f"{R}/realtime/publish", json={"channel": "nonsense", "event": "notice.new"}, headers=as_user("ADMIN")).status_code == 422
    assert client.post(f"{R}/realtime/publish", json={"channel": "all", "event": "notice.new", "payload": {"t": "x" * 9000}}, headers=as_user("ADMIN")).status_code == 413
    ws, s, _ = connect(client, tok(client, "SO01")["access_token"])
    r = client.post(f"{R}/realtime/publish", json={"channel": "all", "event": "notice.new", "payload": {"title": "Scheme extended"}}, headers=as_user("ADMIN"))
    m, _ = until(s, lambda m: m.get("event") == "notice.new")
    assert r.status_code == 200 and m["id"] == r.json()["id"] and m["payload"]["title"] == "Scheme extended"
    ws.__exit__(None, None, None)
    st = client.get(f"{R}/admin/realtime", headers=as_user("ADMIN")).json()
    assert st["listening"] is True and st["events_dispatched"] >= 1 and client.get(f"{R}/admin/realtime", headers=as_user("GM01")).status_code == 403


def test_document_changes_are_published_when_the_collection_says_so(client, as_user, sql):
    sql("delete from platform.documents")
    sql("delete from platform.collections")
    spec = {"name": "board", "label": "Board", "read_rule": "authenticated", "write_rule": "owner", "realtime": True, "fields": [{"name": "text", "type": "string", "required": True}]}
    client.put(f"{R}/admin/collections", json=spec, headers=as_user("ADMIN"))
    client.put(f"{R}/admin/collections", json={**spec, "name": "quiet", "realtime": False}, headers=as_user("ADMIN"))
    ws, s, _ = connect(client, tok(client, "SO02")["access_token"])
    s.send_json({"type": "subscribe", "channel": "data:board", "ref": 1})
    assert until(s, lambda m: m.get("ref") == 1)[0]["type"] == "subscribed"
    s.send_json({"type": "subscribe", "channel": "data:quiet", "ref": 2})
    assert until(s, lambda m: m.get("ref") == 2)[0]["type"] == "error"
    d = client.post(f"{R}/data/board", json={"text": "hello"}, headers=as_user("SO01")).json()
    m, _ = until(s, lambda m: m.get("event") == "document.create")
    assert m["payload"]["id"] == d["id"] and m["payload"]["data"] == {"text": "hello"}
    client.delete(f"{R}/data/board/{d['id']}", headers=as_user("SO01"))
    assert until(s, lambda m: m.get("event") == "document.delete")[0]["payload"]["data"] is None
    ws.__exit__(None, None, None)


def test_ending_a_login_closes_its_socket(client, monkeypatch):
    monkeypatch.setattr(hubmod, "SWEEP_SECONDS", 0.2)
    t = tok(client, "SO04")
    with client.websocket_connect("/ws") as s:
        s.send_json({"type": "auth", "token": t["access_token"]})
        assert s.receive_json()["type"] == "ready"
        assert client.post(f"{R}/auth/logout", headers={"authorization": f"Bearer {t['access_token']}"}).status_code == 200
        with pytest.raises(WebSocketDisconnect) as e:
            for _ in range(50):
                s.receive_json()
        assert e.value.code == 4401


# ---------- chat ----------
def test_chat_between_two_people_with_delivery_and_read_receipts(client, sql):
    a_id, b_id, c_id = uid(sql, "SO01"), uid(sql, "ASM01"), uid(sql, "SO02")
    ta, tb, tc = tok(client, "SO01"), tok(client, "ASM01"), tok(client, "SO02")
    ha, hb, hc = ({"authorization": f"Bearer {t['access_token']}"} for t in (ta, tb, tc))
    room = client.post(f"{R}/chat/rooms", json={"user_ids": [b_id]}, headers=ha).json()
    assert room["kind"] == "direct" and client.post(f"{R}/chat/rooms", json={"user_ids": [a_id]}, headers=hb).json()["id"] == room["id"]  # one room for the pair, whoever opens it
    wa, a, _ = connect(client, ta["access_token"])
    wb, b, _ = connect(client, tb["access_token"])
    a.send_json({"type": "chat.send", "room": room["id"], "text": "Stock report for Bara is in", "client_id": "m-1", "ref": 1})
    sent, _ = until(a, lambda m: m["type"] == "chat.sent")
    got, _ = until(b, lambda m: m.get("event") == "chat.message")
    assert got["payload"]["text"] == "Stock report for Bara is in" and got["payload"]["sender_id"] == a_id and got["payload"]["id"] == sent["message"]["id"]
    delivered, _ = until(a, lambda m: m.get("event") == "chat.receipt" and m["payload"]["user_id"] == b_id)
    assert delivered["payload"]["delivered_id"] == sent["message"]["id"] and delivered["payload"]["read_id"] == 0
    b.send_json({"type": "chat.read", "room": room["id"], "upto": sent["message"]["id"]})
    read, _ = until(a, lambda m: m.get("event") == "chat.receipt" and m["payload"]["read_id"] == sent["message"]["id"])
    assert read["payload"]["user_id"] == b_id
    # the same message sent again (lost connection) is stored once
    a.send_json({"type": "chat.send", "room": room["id"], "text": "Stock report for Bara is in", "client_id": "m-1", "ref": 2})
    again, _ = until(a, lambda m: m["type"] == "chat.sent" and m.get("ref") == 2)
    assert again["message"]["id"] == sent["message"]["id"] and sql("select count(*) from platform.chat_messages").scalar() == 1
    # somebody outside the conversation
    assert client.get(f"{R}/chat/rooms/{room['id']}/messages", headers=hc).status_code == 404
    assert client.post(f"{R}/chat/rooms/{room['id']}/messages", json={"text": "let me in"}, headers=hc).status_code == 404
    wc, c, _ = connect(client, tc["access_token"])
    c.send_json({"type": "chat.send", "room": room["id"], "text": "let me in", "ref": 9})
    assert until(c, lambda m: m.get("ref") == 9)[0]["code"] == "not_found"
    for w in (wa, wb, wc):
        w.__exit__(None, None, None)
    assert c_id not in (a_id, b_id)


def test_offline_recipient_sees_unread_count_and_history(client, sql):
    a_id, b_id = uid(sql, "SO05"), uid(sql, "SO06")
    ha, hb = ({"authorization": f"Bearer {tok(client, c)['access_token']}"} for c in ("SO05", "SO06"))
    room = client.post(f"{R}/chat/rooms", json={"user_ids": [b_id]}, headers=ha).json()["id"]
    for i in range(3):
        assert client.post(f"{R}/chat/rooms/{room}/messages", json={"text": f"message {i}"}, headers=ha).status_code == 201
    assert client.post(f"{R}/chat/rooms/{room}/messages", json={"text": "  "}, headers=ha).status_code == 422
    rb = client.get(f"{R}/chat/rooms", headers=hb).json()["rooms"][0]
    assert rb["unread"] == 3 and rb["last"]["text"] == "message 2" and rb["title"] and client.get(f"{R}/chat/rooms", headers=ha).json()["rooms"][0]["unread"] == 0
    hist = client.get(f"{R}/chat/rooms/{room}/messages?limit=2", headers=hb).json()
    assert [m["text"] for m in hist["messages"]] == ["message 1", "message 2"]
    older = client.get(f"{R}/chat/rooms/{room}/messages?before={hist['messages'][0]['id']}", headers=hb).json()
    assert [m["text"] for m in older["messages"]] == ["message 0"]
    assert next(m for m in client.get(f"{R}/chat/rooms/{room}/messages", headers=ha).json()["members"] if m["user_id"] == b_id)["last_delivered_id"] == hist["messages"][-1]["id"]  # fetching counts as delivered
    assert client.post(f"{R}/chat/rooms/{room}/read", headers=hb).status_code == 200
    assert client.get(f"{R}/chat/rooms", headers=hb).json()["rooms"][0]["unread"] == 0 and a_id != b_id


def test_group_chat_and_its_limits(client, sql):
    ids = [uid(sql, c) for c in ("SO01", "SO02", "SO03")]
    h = {"authorization": f"Bearer {tok(client, 'ASM01')['access_token']}"}
    g = client.post(f"{R}/chat/rooms", json={"user_ids": ids, "name": "Birgunj team"}, headers=h).json()
    assert g["kind"] == "group" and g["name"] == "Birgunj team"
    assert client.post(f"{R}/chat/rooms", json={"user_ids": [999999]}, headers=h).status_code == 422
    assert client.post(f"{R}/chat/rooms", json={"user_ids": []}, headers=h).status_code == 422
    sql("update public.roles set permissions = permissions - 'chat.use' where key = 'so'")
    try:
        so = {"authorization": f"Bearer {tok(client, 'SO01')['access_token']}"}
        assert client.post(f"{R}/chat/rooms/{g['id']}/messages", json={"text": "hi"}, headers=so).status_code == 403
    finally:
        sql("""update public.roles set permissions = permissions || '["chat.use"]'::jsonb where key = 'so'""")
    p = client.get(f"{R}/realtime/presence?users={ids[0]},{ids[1]}", headers=h).json()["online"]
    assert p == {str(ids[0]): False, str(ids[1]): False}
    ws, s, _ = connect(client, tok(client, "SO01")["access_token"])
    time.sleep(0.05)
    assert client.get(f"{R}/realtime/presence?users={ids[0]},{ids[1]}", headers=h).json()["online"] == {str(ids[0]): True, str(ids[1]): False}
    ws.__exit__(None, None, None)
