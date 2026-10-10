import time
from datetime import UTC, datetime, timedelta

import bcrypt
import jwt
import pytest

from app.config import get_settings
from app.security import digest, hash_password, needs_upgrade, verify_password
from app.services import mail

PW = "Everest@123"
A = "/api/v1/auth"


def login(client, code="SO01", pw=PW, device=None, ip="10.0.0.1"):
    return client.post(f"{A}/login", json={"login": code, "password": pw, **({"device": device} if device else {})}, headers={"x-forwarded-for": ip})


def auth(tok):
    return {"authorization": f"Bearer {tok}"}


@pytest.fixture(autouse=True)
def clean(sql):
    """Each test starts with no lockouts, no rate-limit counts and the sample passwords."""
    sql("delete from platform.rate_limits")
    sql("update public.users set failed_logins = 0, locked_until = null, active = true where code like 'SO%' or code in ('ASM01','GM01','CC01','RSM01')")
    yield


@pytest.fixture()
def gm_manages_people(sql):
    """In the sample data only the Super Admin may edit employees. Give the General Manager that right to test the level rule."""
    sql("""update public.roles set permissions = permissions || '["employees.edit"]'::jsonb where key = 'gm' and not permissions ? 'employees.edit'""")
    yield
    sql("update public.roles set permissions = permissions - 'employees.edit' where key = 'gm'")


@pytest.fixture()
def restore_password(sql):
    yield
    sql("update public.users set password_hash = :h, must_change_password = false where code in ('SO02','SO03')", h=bcrypt.hashpw(PW.encode(), bcrypt.gensalt(4)).decode())


# ---------- passwords ----------
def test_old_bcrypt_hashes_still_verify_and_new_ones_are_argon2id():
    old = bcrypt.hashpw(b"secret-one", bcrypt.gensalt(4)).decode()
    assert verify_password("secret-one", old) and not verify_password("nope", old) and needs_upgrade(old)
    new = hash_password("secret-one")
    assert new.startswith("$argon2id$") and verify_password("secret-one", new) and not verify_password("x", new) and not needs_upgrade(new)
    assert not verify_password("x", "not-a-hash") and not verify_password("x", "")


def test_login_upgrades_a_bcrypt_hash_to_argon2id(client, sql):
    sql("update public.users set password_hash = :h where code = 'SO04'", h=bcrypt.hashpw(PW.encode(), bcrypt.gensalt(4)).decode())
    assert login(client, "SO04").status_code == 200
    assert sql("select password_hash from public.users where code = 'SO04'").scalar().startswith("$argon2id$")
    assert login(client, "SO04").status_code == 200  # and the upgraded hash works


# ---------- login ----------
def test_login_returns_short_access_token_and_refresh_token(client, sql):
    r = login(client, device={"installation_id": "phone-aaaa-1111", "platform": "android", "model": "Test Phone", "app_version": "0.1.0"})
    body = r.json()
    assert r.status_code == 200, body
    claims = jwt.decode(body["access_token"], get_settings().auth_secret, algorithms=["HS256"])
    assert claims["typ"] == "access" and claims["exp"] - claims["iat"] == 15 * 60 and claims["sid"] == body["session_id"]
    assert body["user"]["code"] == "SO01" and "orders.create" in body["user"]["permissions"] and "password_hash" not in str(body)
    assert sql("select token_hash from platform.refresh_tokens where session_id = :s", s=body["session_id"]).scalar() == digest(body["refresh_token"])  # only the hash is stored
    dev = sql("select platform, model from platform.devices where installation_id = 'phone-aaaa-1111'").first()
    assert tuple(dev) == ("android", "Test Phone")
    assert client.get(f"{A}/me", headers=auth(body["access_token"])).json()["user"]["code"] == "SO01"


def test_login_by_mobile_number_and_case_insensitive_code(client, sql):
    sql("update public.users set phone = '9811111111' where code = 'SO01'")
    assert login(client, "so01").status_code == 200 and login(client, "9811111111").status_code == 200


def test_wrong_password_unknown_user_and_inactive_all_look_the_same(client, sql):
    sql("update public.users set active = false where code = 'SO05'")
    answers = {login(client, "SO01", "wrong").json()["error"], login(client, "NOBODY", "wrong").json()["error"], login(client, "SO05").json()["error"]}
    assert answers == {"Employee code or password is wrong."}
    outcomes = [r[0] for r in sql("select outcome from platform.login_events order by id desc limit 3")]
    assert outcomes == ["inactive", "unknown_user", "wrong_password"]  # but the security history knows the difference


def test_account_locks_after_five_wrong_passwords(client, sql):
    for i in range(5):
        assert login(client, "SO06", "wrong", ip=f"10.1.0.{i}").status_code == 401
    r = login(client, "SO06", PW, ip="10.1.0.99")
    assert r.status_code == 423 and r.json()["code"] == "locked"
    sql("update public.users set locked_until = now() - interval '1 minute' where code = 'SO06'")
    assert login(client, "SO06", PW, ip="10.1.0.99").status_code == 200


def test_one_network_address_is_limited_across_accounts(client, sql):
    for i in range(20):
        assert login(client, f"GHOST{i}", "x", ip="10.2.0.1").status_code == 401
    r = login(client, "SO01", PW, ip="10.2.0.1")
    assert r.status_code == 429 and r.json()["code"] == "rate_limited"
    assert login(client, "SO01", PW, ip="10.2.0.2").status_code == 200  # other networks are not affected
    assert sql("select count from platform.rate_limits where key = 'login-ip:10.2.0.1'").scalar() == 20  # kept in the database, so it survives a restart


def test_validation_errors_use_the_common_shape(client):
    r = client.post(f"{A}/login", json={"login": "SO01"})
    assert r.status_code == 422 and r.json()["code"] == "invalid_request" and "password" in r.json()["fields"]
    assert client.post(f"{A}/login", json={"login": "SO01", "password": PW, "device": {"installation_id": "x", "platform": "symbian"}}).status_code == 422


# ---------- tokens ----------
def test_no_token_bad_token_and_expired_token_are_refused(client):
    assert client.get(f"{A}/me").status_code == 401
    assert client.get(f"{A}/me", headers=auth("abc.def.ghi")).status_code == 401
    s = get_settings()
    old = jwt.encode({"uid": 1, "tv": 0, "iat": datetime.now(UTC) - timedelta(hours=2), "exp": datetime.now(UTC) - timedelta(hours=1)}, s.auth_secret, algorithm="HS256")
    assert client.get(f"{A}/me", headers=auth(old)).status_code == 401
    forged = jwt.encode({"uid": 1, "tv": 0, "iat": datetime.now(UTC), "exp": datetime.now(UTC) + timedelta(hours=1)}, "another-secret-another-secret-123456", algorithm="HS256")
    assert client.get(f"{A}/me", headers=auth(forged)).status_code == 401
    none_alg = jwt.encode({"uid": 1, "tv": 0, "iat": datetime.now(UTC), "exp": datetime.now(UTC) + timedelta(hours=1)}, None, algorithm="none")
    assert client.get(f"{A}/me", headers=auth(none_alg)).status_code == 401


def test_a_token_from_the_web_apps_own_login_is_accepted(client, sql):
    uid, tv = sql("select id, token_version from public.users where code = 'GM01'").first()
    web = jwt.encode({"uid": uid, "tv": tv, "iat": datetime.now(UTC), "exp": datetime.now(UTC) + timedelta(days=30)}, get_settings().auth_secret, algorithm="HS256")
    r = client.get(f"{A}/me", headers=auth(web))
    assert r.status_code == 200 and r.json()["user"]["code"] == "GM01" and r.json()["session_id"] is None
    client.cookies.set("sfa_session", web)
    assert client.get(f"{A}/me").json()["user"]["code"] == "GM01"  # and as the browser's cookie
    assert client.post(f"{A}/logout", headers={"origin": "https://evil.example"}).status_code == 403  # a changing request with the cookie from another site is refused
    assert client.post(f"{A}/logout", headers={"origin": "http://testserver"}).status_code == 200
    client.cookies.clear()


def test_refresh_rotates_and_the_old_token_stops_working_after_the_grace_period(client, sql):
    first = login(client).json()
    second = client.post(f"{A}/refresh", json={"refresh_token": first["refresh_token"]}).json()
    assert second["refresh_token"] != first["refresh_token"] and second["session_id"] == first["session_id"]
    assert client.get(f"{A}/me", headers=auth(second["access_token"])).status_code == 200
    # lost answer: the same token again within the grace period is allowed
    again = client.post(f"{A}/refresh", json={"refresh_token": first["refresh_token"]})
    assert again.status_code == 200
    # long after: it is treated as stolen and the whole login is ended
    sql("update platform.refresh_tokens set used_at = now() - interval '5 minutes' where token_hash = :h", h=digest(first["refresh_token"]))
    stolen = client.post(f"{A}/refresh", json={"refresh_token": first["refresh_token"]})
    assert stolen.status_code == 401 and stolen.json()["code"] == "invalid_refresh"
    assert client.post(f"{A}/refresh", json={"refresh_token": second["refresh_token"]}).status_code == 401  # the thief's and the owner's tokens are both dead
    assert client.get(f"{A}/me", headers=auth(second["access_token"])).status_code == 401  # and the access token too
    assert sql("select revoke_reason from platform.sessions where id = :s", s=first["session_id"]).scalar() == "refresh_reuse"
    assert sql("select outcome from platform.login_events order by id desc limit 1").scalar() == "refresh_reuse"


def test_refresh_refuses_unknown_and_expired_tokens(client, sql):
    assert client.post(f"{A}/refresh", json={"refresh_token": "x" * 40}).status_code == 401
    t = login(client).json()
    sql("update platform.refresh_tokens set expires_at = now() - interval '1 minute' where token_hash = :h", h=digest(t["refresh_token"]))
    assert client.post(f"{A}/refresh", json={"refresh_token": t["refresh_token"]}).status_code == 401


def test_logout_ends_only_this_login(client):
    a, b = login(client).json(), login(client).json()
    assert client.post(f"{A}/logout", headers=auth(a["access_token"])).status_code == 200
    assert client.get(f"{A}/me", headers=auth(a["access_token"])).status_code == 401
    assert client.post(f"{A}/refresh", json={"refresh_token": a["refresh_token"]}).status_code == 401
    assert client.get(f"{A}/me", headers=auth(b["access_token"])).status_code == 200


def test_logout_all_ends_every_login_including_web_tokens(client, sql):
    a, b = login(client, "SO07").json(), login(client, "SO07").json()
    uid, tv = sql("select id, token_version from public.users where code = 'SO07'").first()
    web = jwt.encode({"uid": uid, "tv": tv, "iat": datetime.now(UTC), "exp": datetime.now(UTC) + timedelta(days=30)}, get_settings().auth_secret, algorithm="HS256")
    r = client.post(f"{A}/logout-all", headers=auth(a["access_token"]))
    assert r.status_code == 200 and r.json()["sessions_ended"] == 2
    for tok in (a["access_token"], b["access_token"], web):
        assert client.get(f"{A}/me", headers=auth(tok)).status_code == 401


def test_sessions_list_shows_own_logins_and_one_can_be_ended(client):
    a = login(client, "SO08", device={"installation_id": "phone-bbbb-2222", "platform": "ios", "model": "Phone B"}).json()
    b = login(client, "SO08").json()
    other = login(client, "SO09").json()
    lst = client.get(f"{A}/sessions", headers=auth(a["access_token"])).json()["sessions"]
    assert {s["id"] for s in lst} >= {a["session_id"], b["session_id"]} and other["session_id"] not in {s["id"] for s in lst}
    assert next(s for s in lst if s["id"] == a["session_id"])["current"] is True and next(s for s in lst if s["id"] == a["session_id"])["device"] == "Phone B"
    assert client.delete(f"{A}/sessions/{other['session_id']}", headers=auth(a["access_token"])).status_code == 404  # somebody else's login
    assert client.delete(f"{A}/sessions/not-a-uuid", headers=auth(a["access_token"])).status_code == 404
    assert client.delete(f"{A}/sessions/{b['session_id']}", headers=auth(a["access_token"])).status_code == 200
    assert client.get(f"{A}/me", headers=auth(b["access_token"])).status_code == 401 and client.get(f"{A}/me", headers=auth(other["access_token"])).status_code == 200


def test_deactivating_a_person_stops_their_tokens_and_refresh(client, sql):
    t = login(client, "SO10").json()
    sql("update public.users set active = false where code = 'SO10'")
    assert client.get(f"{A}/me", headers=auth(t["access_token"])).status_code == 401
    assert client.post(f"{A}/refresh", json={"refresh_token": t["refresh_token"]}).status_code == 401
    sql("update public.users set active = true where code = 'SO10'")


# ---------- password change and reset ----------
def test_change_password_signs_out_other_devices_and_keeps_this_one(client, restore_password):
    a, b = login(client, "SO02").json(), login(client, "SO02").json()
    assert client.post(f"{A}/password", json={"current": "wrong", "next": "NewPassw0rd!"}, headers=auth(a["access_token"])).status_code == 401
    assert client.post(f"{A}/password", json={"current": PW, "next": "short"}, headers=auth(a["access_token"])).status_code == 422
    assert client.post(f"{A}/password", json={"current": PW, "next": PW}, headers=auth(a["access_token"])).status_code == 422
    r = client.post(f"{A}/password", json={"current": PW, "next": "NewPassw0rd!"}, headers=auth(a["access_token"]))
    assert r.status_code == 200 and r.json()["other_sessions_ended"] == 1
    assert client.get(f"{A}/me", headers=auth(a["access_token"])).status_code == 401  # the old token carried the old version
    assert client.get(f"{A}/me", headers=auth(r.json()["access_token"])).status_code == 200  # this device continues with the new one
    assert client.get(f"{A}/me", headers=auth(b["access_token"])).status_code == 401
    assert login(client, "SO02", PW).status_code == 401 and login(client, "SO02", "NewPassw0rd!").status_code == 200


def test_temporary_password_allows_only_changing_it(client, sql, restore_password):
    sql("update public.users set must_change_password = true where code = 'SO03'")
    t = login(client, "SO03").json()
    assert t["user"]["must_change_password"] is True
    r = client.get(f"{A}/sessions", headers=auth(t["access_token"]))
    assert r.status_code == 403 and r.json()["code"] == "password_change_required"
    r = client.post(f"{A}/password", json={"current": PW, "next": "MyOwnPassw0rd"}, headers=auth(t["access_token"]))
    assert r.status_code == 200 and client.get(f"{A}/sessions", headers=auth(r.json()["access_token"])).status_code == 200


def test_admin_reset_code_is_single_use_expires_and_ends_sessions(client, sql, restore_password, gm_manages_people):
    gm, victim = login(client, "GM01").json(), login(client, "SO03").json()
    uid = sql("select id from public.users where code = 'SO03'").scalar()
    r = client.post(f"/api/v1/admin/users/{uid}/reset-code", headers=auth(gm["access_token"]))
    code = r.json()["code"]
    assert r.status_code == 200 and len(code) == 14 and r.json()["login"] == "SO03"
    assert sql("select count(*) from platform.password_resets where token_hash = :h", h=digest(code)).scalar() == 1  # hash only
    assert client.post(f"{A}/password/reset/confirm", json={"login": "SO03", "token": "AAAA-BBBB-CCCC", "new_password": "Whatever123"}).status_code == 400
    assert client.post(f"{A}/password/reset/confirm", json={"login": "SO04", "token": code, "new_password": "Whatever123"}).status_code == 400  # a code belongs to one person
    assert client.post(f"{A}/password/reset/confirm", json={"login": "SO03", "token": code, "new_password": "short"}).status_code == 422
    ok = client.post(f"{A}/password/reset/confirm", json={"login": "so03", "token": code.lower().replace("-", " "), "new_password": "ResetPassw0rd"})
    assert ok.status_code == 200  # typed without dashes and in lower case
    assert client.get(f"{A}/me", headers=auth(victim["access_token"])).status_code == 401
    assert client.post(f"{A}/password/reset/confirm", json={"login": "SO03", "token": code, "new_password": "AnotherPass1"}).status_code == 400  # used once
    assert login(client, "SO03", "ResetPassw0rd").status_code == 200
    # an expired code
    code2 = client.post(f"/api/v1/admin/users/{uid}/reset-code", headers=auth(gm["access_token"])).json()["code"]
    sql("update platform.password_resets set expires_at = now() - interval '1 minute' where token_hash = :h", h=digest(code2))
    assert client.post(f"{A}/password/reset/confirm", json={"login": "SO03", "token": code2, "new_password": "AnotherPass1"}).status_code == 400


def test_reset_guessing_is_rate_limited(client):
    for _ in range(8):
        assert client.post(f"{A}/password/reset/confirm", json={"login": "SO01", "token": "AAAA-BBBB-CCCC", "new_password": "Whatever123"}, headers={"x-forwarded-for": "10.9.9.9"}).status_code == 400
    assert client.post(f"{A}/password/reset/confirm", json={"login": "SO01", "token": "AAAA-BBBB-CCCC", "new_password": "Whatever123"}, headers={"x-forwarded-for": "10.9.9.9"}).status_code == 429


def test_reset_by_email_when_smtp_is_configured(client, sql, monkeypatch, restore_password):
    s = get_settings()
    monkeypatch.setattr(s, "smtp_host", "smtp.example.test")
    monkeypatch.setattr(s, "smtp_from", "noreply@example.test")
    monkeypatch.setattr(s, "public_url", "https://sales.example.test")
    sql("update public.users set email = 'so02@example.test' where code = 'SO02'")
    mail.outbox.clear()
    same = {client.post(f"{A}/password/reset/request", json={"login": x}).json()["message"] for x in ("SO02", "NOBODY", "SO01")}
    assert len(same) == 1  # the answer never says whether the account exists
    assert len(mail.outbox) == 1 and mail.outbox[0]["To"] == "so02@example.test"
    link = next(w for w in mail.outbox[0].get_content().split() if w.startswith("https://sales.example.test/login?reset="))
    token = link.split("reset=")[1].split("&")[0]
    assert client.post(f"{A}/password/reset/confirm", json={"login": "SO02", "token": token, "new_password": "EmailedPassw0rd"}).status_code == 200
    assert login(client, "SO02", "EmailedPassw0rd").status_code == 200


# ---------- administrators ----------
def test_admin_actions_respect_levels(client, sql, gm_manages_people):
    asm, gm, so = login(client, "ASM01").json(), login(client, "GM01").json(), login(client, "SO01").json()
    ids = {c: sql("select id from public.users where code = :c", c=c).scalar() for c in ("SO01", "ASM01", "GM01", "ADMIN", "RSM01")}
    assert client.post(f"/api/v1/admin/users/{ids['SO01']}/logout-all", headers=auth(so["access_token"])).status_code == 403  # no permission at all
    assert client.post(f"/api/v1/admin/users/{ids['SO01']}/logout-all", headers=auth(asm["access_token"])).status_code == 403  # an ASM has no employees.edit
    assert client.post(f"/api/v1/admin/users/{ids['ADMIN']}/reset-code", headers=auth(gm["access_token"])).status_code == 403  # a GM cannot take over the Super Admin
    assert client.post(f"/api/v1/admin/users/{ids['GM01']}/suspend", headers=auth(gm["access_token"])).status_code == 403  # nor act on their own level
    assert client.post("/api/v1/admin/users/999999/suspend", headers=auth(gm["access_token"])).status_code == 404
    r = client.post(f"/api/v1/admin/users/{ids['SO01']}/logout-all", headers=auth(gm["access_token"]))
    assert r.status_code == 200 and r.json()["sessions_ended"] >= 1
    assert client.get(f"{A}/me", headers=auth(so["access_token"])).status_code == 401
    assert sql("select action from public.audit_logs order by id desc limit 1").scalar() == "force-logout"  # privileged actions reach the audit log
    # the Super Admin may act on anyone, including the General Manager
    sql("update public.users set must_change_password = false where code = 'ADMIN'")
    boss = login(client, "ADMIN").json()
    assert client.post(f"/api/v1/admin/users/{ids['GM01']}/logout-all", headers=auth(boss["access_token"])).status_code == 200
    assert client.get(f"{A}/me", headers=auth(gm["access_token"])).status_code == 401


def test_suspend_and_activate(client, sql, gm_manages_people):
    gm, so = login(client, "GM01").json(), login(client, "SO09").json()
    uid = sql("select id from public.users where code = 'SO09'").scalar()
    assert client.post(f"/api/v1/admin/users/{uid}/suspend", headers=auth(gm["access_token"])).status_code == 200
    assert client.get(f"{A}/me", headers=auth(so["access_token"])).status_code == 401 and login(client, "SO09").status_code == 401
    assert client.post(f"/api/v1/admin/users/{uid}/reset-code", headers=auth(gm["access_token"])).status_code == 422
    assert client.post(f"/api/v1/admin/users/{uid}/activate", headers=auth(gm["access_token"])).status_code == 200
    assert login(client, "SO09").status_code == 200


def test_login_history_is_for_those_with_audit_permission(client):
    gm, so = login(client, "GM01").json(), login(client, "SO01").json()
    login(client, "SO01", "wrong")
    assert client.get("/api/v1/admin/login-events", headers=auth(so["access_token"])).status_code == 403
    r = client.get("/api/v1/admin/login-events?outcome=wrong_password&limit=5", headers=auth(gm["access_token"]))
    ev = r.json()["events"]
    assert r.status_code == 200 and ev and ev[0]["outcome"] == "wrong_password" and ev[0]["login"] == "SO01" and "password" not in ev[0]


def test_two_refreshes_at_once_do_not_break_the_login(client):
    t = login(client).json()
    a = client.post(f"{A}/refresh", json={"refresh_token": t["refresh_token"]})
    b = client.post(f"{A}/refresh", json={"refresh_token": t["refresh_token"]})
    assert a.status_code == 200 and b.status_code == 200
    time.sleep(0.01)
    assert client.get(f"{A}/me", headers=auth(b.json()["access_token"])).status_code == 200


def test_a_sign_out_made_by_the_web_app_also_stops_refresh(client, sql):
    """The web app ends every login by raising token_version. A phone must not be able to refresh its way back in."""
    t = login(client, "SO08").json()
    sql("update public.users set token_version = token_version + 1 where code = 'SO08'")
    assert client.get(f"{A}/me", headers=auth(t["access_token"])).status_code == 401
    r = client.post(f"{A}/refresh", json={"refresh_token": t["refresh_token"]})
    assert r.status_code == 401
    assert sql("select revoke_reason from platform.sessions where id = :s", s=t["session_id"]).scalar() == "signed_out_everywhere"
