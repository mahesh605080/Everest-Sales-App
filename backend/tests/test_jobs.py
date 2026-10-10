import asyncio
import uuid
from datetime import UTC, datetime, time

import pytest

from app import metrics, worker
from app.config import get_settings
from app.db import session_factory
from app.services import jobs as svc
from app.services import monitor
from app.services.jobs import Kind

A = "/api/v1/admin"


@pytest.fixture(autouse=True)
def clean(sql):
    for t in ("jobs", "schedules", "alerts", "notifications", "push_subscriptions"):
        sql(f"delete from platform.{t}")
    sql("delete from public.notifications where title like 'Warning:%' or title like 'Critical:%'")
    yield
    get_settings.cache_clear()


@pytest.fixture()
def admin(as_user):
    return as_user("ADMIN")


def job_row(sql, jid):
    return dict(sql("select status, attempts, last_error, result, run_at, finished_at from platform.jobs where id = :i", i=jid).mappings().one())


# ---------- only built-in kinds, only inside their limits ----------
def test_only_the_super_admin_and_only_known_kinds(client, as_user, admin):
    assert client.get(f"{A}/jobs").status_code == 401
    for path in ("jobs", "jobs/kinds", "schedules", "alerts", "monitor"):
        assert client.get(f"{A}/{path}", headers=as_user("GM01")).status_code == 403, path
    assert client.post(f"{A}/jobs", json={"kind": "events.prune"}, headers=as_user("GM01")).status_code == 403
    kinds = {k["kind"]: k for k in client.get(f"{A}/jobs/kinds", headers=admin).json()["kinds"]}
    assert set(kinds) == {"files.purge_deleted", "events.prune", "auth.cleanup", "notify.prune", "jobs.prune", "monitor.check", "web.alert_rules"}
    assert kinds["events.prune"]["params"] == {"keep_days": {"default": 14, "min": 1, "max": 365}}
    bad = [{"kind": "shell.exec", "payload": {"cmd": "rm -rf /"}}, {"kind": "sql.run"}, {"kind": "events.prune", "payload": {"keep_days": 0}}, {"kind": "events.prune", "payload": {"keep_days": 100000}},
           {"kind": "events.prune", "payload": {"keep_days": "14; drop table users"}}, {"kind": "events.prune", "payload": {"keep_days": True}}, {"kind": "events.prune", "payload": {"keep_days": 1.5}},
           {"kind": "events.prune", "payload": {"table": "public.users"}}]
    for b in bad:
        assert client.post(f"{A}/jobs", json=b, headers=admin).status_code == 422, b
    assert client.get(f"{A}/jobs", headers=admin).json()["jobs"] == []


def test_run_now_once_at_a_time(client, admin, sql, db):
    sql("insert into platform.events(channel, type, created_at) values ('all', 'old', now() - interval '20 days'), ('all', 'recent', now() - interval '2 days')")
    r = client.post(f"{A}/jobs", json={"kind": "events.prune"}, headers=admin)
    assert r.status_code == 201 and r.json()["status"] == "queued" and r.json()["payload"] == {"keep_days": 14}
    assert client.post(f"{A}/jobs", json={"kind": "events.prune"}, headers=admin).status_code == 409      # the same work is not queued twice
    out = svc.run_one(db)
    assert out["status"] == "done" and svc.run_one(db) is None
    j = client.get(f"{A}/jobs/{r.json()['id']}", headers=admin).json()
    assert j["status"] == "done" and j["result"] == {"deleted": 1} and j["attempts"] == 1 and j["seconds"] is not None and j["created_by"] is not None
    assert sql("select type from platform.events where type in ('old', 'recent')").scalars().all() == ["recent"]
    assert client.post(f"{A}/jobs", json={"kind": "events.prune"}, headers=admin).status_code == 201      # finished: may run again
    assert client.get(f"{A}/jobs?status=done", headers=admin).json()["counts"]["last_7_days"] == {"done": 1, "queued": 1}


# ---------- failure, retry, giving up ----------
@pytest.fixture()
def flaky(monkeypatch):
    box = {"fail": True, "calls": 0}

    def fn(db, p):
        from sqlalchemy import text
        box["calls"] += 1
        db.execute(text("insert into platform.settings(key, value, label) values ('test.half_done', '1', 'x') on conflict (key) do nothing"))
        if box["fail"]:
            raise RuntimeError("the disk caught fire\nsecond line with detail")
        return {"n": p["n"]}
    monkeypatch.setitem(svc.KINDS, "test.flaky", Kind(fn, "A job for the tests", {"n": (1, 0, 9)}, max_attempts=3))
    yield box
    with session_factory()() as s:
        from sqlalchemy import text
        s.execute(text("delete from platform.settings where key = 'test.half_done'"))
        s.commit()


def test_a_failure_undoes_the_work_keeps_the_record_and_retries_later(client, admin, sql, db, flaky):
    jid = client.post(f"{A}/jobs", json={"kind": "test.flaky"}, headers=admin).json()["id"]
    assert svc.run_one(db)["status"] == "queued"
    j = job_row(sql, jid)
    assert j["status"] == "queued" and j["attempts"] == 1 and j["last_error"] == "RuntimeError: the disk caught fire"
    assert 50 <= (j["run_at"] - datetime.now(UTC)).total_seconds() <= 65                 # waits a minute
    assert sql("select count(*) from platform.settings where key = 'test.half_done'").scalar() == 0     # the half-done work was undone
    assert svc.run_one(db) is None                                                         # not before its time
    sql("update platform.jobs set run_at = now()")
    assert svc.run_one(db)["status"] == "queued"
    assert 110 <= (job_row(sql, jid)["run_at"] - datetime.now(UTC)).total_seconds() <= 125  # then two
    sql("update platform.jobs set run_at = now()")
    assert svc.run_one(db)["status"] == "dead"                                             # the third failure is the last
    j = job_row(sql, jid)
    assert j["status"] == "dead" and j["attempts"] == 3 and j["finished_at"] is not None and flaky["calls"] == 3
    # an administrator fixes the cause and runs it again
    assert client.post(f"{A}/jobs/{jid}/cancel", headers=admin).status_code == 409
    flaky["fail"] = False
    assert client.post(f"{A}/jobs/{jid}/retry", headers=admin).json()["status"] == "queued"
    assert client.post(f"{A}/jobs/{jid}/retry", headers=admin).status_code == 409
    assert svc.run_one(db)["status"] == "done"
    assert job_row(sql, jid)["result"] == {"n": 1} and sql("select count(*) from platform.settings where key = 'test.half_done'").scalar() == 1


def test_cancel_a_waiting_job(client, admin, sql, db, flaky):
    jid = client.post(f"{A}/jobs", json={"kind": "test.flaky"}, headers=admin).json()["id"]
    assert client.post(f"{A}/jobs/{jid}/cancel", headers=admin).json()["status"] == "cancelled"
    assert svc.run_one(db) is None and flaky["calls"] == 0
    assert client.post(f"{A}/jobs/99999999/cancel", headers=admin).status_code == 404


def test_two_workers_never_take_the_same_job_and_a_dead_workers_job_returns(sql, db, flaky):
    flaky["fail"] = False
    a = svc.enqueue(db, "test.flaky", {"n": 1})
    b = svc.enqueue(db, "test.flaky", {"n": 2})
    db.commit()
    with session_factory()() as other:
        one, two, three = svc.claim(db), svc.claim(other), svc.claim(other)
    assert {one.id, two.id} == {a, b} and three is None
    assert svc.recover(db) == 0                                    # they may still be running
    sql("update platform.jobs set started_at = now() - interval '20 minutes' where id = :i", i=a)
    sql("update platform.jobs set started_at = now() - interval '20 minutes', attempts = 3 where id = :i", i=b)
    assert svc.recover(db) == 2
    assert job_row(sql, a)["status"] == "queued" and job_row(sql, b)["status"] == "dead" and "worker stopped" in job_row(sql, b)["last_error"]
    assert svc.run_one(db)["id"] == a and flaky["calls"] == 1


def test_a_kind_removed_from_the_code_fails_cleanly(sql, db):
    sql("insert into platform.jobs(kind, status, attempts, max_attempts, priority) values ('gone.kind', 'queued', 0, 3, 5)")
    assert svc.run_one(db)["status"] == "dead"
    assert "no such kind" in sql("select last_error from platform.jobs").scalar()


# ---------- the web app's alert rules ----------
def test_web_alert_rules_are_skipped_until_configured_then_called_with_the_key_in_a_header(client, admin, sql, db, monkeypatch):
    jid = svc.enqueue(db, "web.alert_rules")
    db.commit()
    assert svc.run_one(db)["status"] == "done" and "not both set" in job_row(sql, jid)["result"]["skipped"]
    monkeypatch.setenv("WEB_INTERNAL_URL", "http://app:3000/")
    monkeypatch.setenv("CRON_SECRET", "s3cret-cron-key-0123456789")
    get_settings.cache_clear()
    seen = {}

    class R:
        status_code = 200

    def get(url, headers=None, timeout=None, follow_redirects=None):
        seen.update(url=url, headers=headers, follow=follow_redirects)
        return R()
    monkeypatch.setattr(svc.httpx, "get", get)
    jid = svc.enqueue(db, "web.alert_rules")
    db.commit()
    assert svc.run_one(db)["status"] == "done"
    assert seen == {"url": "http://app:3000/api/cron/alerts", "headers": {"x-cron-key": "s3cret-cron-key-0123456789"}, "follow": False}
    R.status_code = 403
    jid = svc.enqueue(db, "web.alert_rules")
    db.commit()
    svc.run_one(db)
    j = job_row(sql, jid)
    assert j["last_error"] == "RuntimeError: the web app answered 403" and "s3cret" not in str(j)
    assert "s3cret" not in client.get(f"{A}/monitor", headers=admin).text and "s3cret" not in client.get(f"{A}/jobs", headers=admin).text


# ---------- schedules ----------
def test_standard_schedules_are_made_once_and_keep_an_administrators_changes(client, admin, sql, db):
    assert svc.ensure_schedules(db) == 7 and svc.ensure_schedules(db) == 0
    rows = {s["name"]: s for s in client.get(f"{A}/schedules", headers=admin).json()["schedules"]}
    assert set(rows) == {"monitor", "web-alert-rules", "purge-deleted-files", "prune-events", "auth-cleanup", "prune-notifications", "prune-jobs"}
    assert rows["monitor"]["every_seconds"] == 300 and rows["purge-deleted-files"]["daily_at"] == "02:30" and rows["web-alert-rules"]["enabled"] is False   # off until the web address and key are set
    r = client.patch(f"{A}/schedules/prune-events", json={"enabled": False, "payload": {"keep_days": 30}}, headers=admin)
    assert r.status_code == 200 and r.json()["enabled"] is False and r.json()["payload"] == {"keep_days": 30}
    assert svc.ensure_schedules(db) == 0
    assert sql("select enabled, payload->>'keep_days' from platform.schedules where name = 'prune-events'").one() == (False, "30")
    for bad in [{"every_seconds": 5}, {"every_seconds": 600, "daily_at": "02:00"}, {"daily_at": "nonsense"}, {"payload": {"keep_days": 0}}, {"payload": {"sql": "x"}}]:
        assert client.patch(f"{A}/schedules/prune-events", json=bad, headers=admin).status_code == 422, bad
    assert client.patch(f"{A}/schedules/nope", json={"enabled": True}, headers=admin).status_code == 404
    r = client.patch(f"{A}/schedules/monitor", json={"every_seconds": 600}, headers=admin).json()
    assert r["every_seconds"] == 600 and 590 <= (datetime.fromisoformat(r["next_run_at"]) - datetime.now(UTC)).total_seconds() <= 601
    r = client.patch(f"{A}/schedules/monitor", json={"daily_at": "06:15"}, headers=admin).json()
    assert r["daily_at"] == "06:15" and r["every_seconds"] is None


def test_a_due_schedule_queues_one_job_and_not_another_while_it_waits(client, admin, sql, db):
    svc.ensure_schedules(db)
    assert svc.schedule_due(db) == 0                                # nothing is due at the moment of creation
    sql("update platform.schedules set next_run_at = now() - interval '3 hours' where name in ('prune-events', 'web-alert-rules')")
    assert svc.schedule_due(db) == 1                                # the disabled one is left alone
    s = sql("select next_run_at, last_job_id from platform.schedules where name = 'prune-events'").one()
    assert s.next_run_at > datetime.now(UTC) and s.last_job_id is not None    # after a long stop it runs once, not once per missed turn
    sql("update platform.schedules set next_run_at = now() - interval '1 minute' where name = 'prune-events'")
    assert svc.schedule_due(db) == 0 and sql("select count(*) from platform.jobs").scalar() == 1    # the first has not run yet
    assert svc.run_one(db)["status"] == "done"
    assert sql("select last_status, last_run_at is not null from platform.schedules where name = 'prune-events'").one() == ("done", True)
    r = client.post(f"{A}/schedules/prune-events/run", headers=admin)
    assert r.status_code == 201 and r.json()["schedule"] == "prune-events"
    assert client.post(f"{A}/schedules/prune-events/run", headers=admin).status_code == 409


def test_next_run_arithmetic():
    at = lambda h, m=0, d=10: datetime(2026, 10, d, h, m, tzinfo=svc.NPT)  # noqa: E731
    assert svc.next_run(300, None, at(9)) == at(9, 5)
    assert svc.next_run(None, time(2, 30), at(1)) == at(2, 30)
    assert svc.next_run(None, time(2, 30), at(2, 30)) == at(2, 30, 11)        # exactly on time: tomorrow
    assert svc.next_run(None, time(2, 30), at(23, 59)) == at(2, 30, 11)
    utc = svc.next_run(None, time(2, 30), datetime(2026, 10, 10, 20, 0, tzinfo=UTC))   # 01:45 in Nepal on the 11th
    assert utc == datetime(2026, 10, 10, 20, 45, tzinfo=UTC)


# ---------- the cleaning jobs ----------
def run_kind(db, kind, payload=None):
    jid = svc.enqueue(db, kind, payload)
    db.commit()
    assert svc.run_one(db)["status"] == "done"
    return jid


def test_auth_cleanup_removes_only_what_is_long_over(sql, db):
    sid = {k: str(uuid.uuid4()) for k in ("live", "ended_recent", "ended_old", "expired_old")}
    q = "insert into platform.sessions(id, user_id, client, token_version, created_at, last_used_at, expires_at, revoked_at) values (cast(:i as uuid), 10, 'web', 0, now(), now(), {e}, {r})"
    sql(q.format(e="now() + interval '10 days'", r="null"), i=sid["live"])
    sql(q.format(e="now() + interval '10 days'", r="now() - interval '5 days'"), i=sid["ended_recent"])
    sql(q.format(e="now() + interval '10 days'", r="now() - interval '120 days'"), i=sid["ended_old"])
    sql(q.format(e="now() - interval '100 days'", r="null"), i=sid["expired_old"])
    sql("insert into platform.login_events(outcome, at) values ('success', now() - interval '400 days'), ('success', now() - interval '10 days')")
    before = sql("select count(*) from platform.login_events").scalar()
    jid = run_kind(db, "auth.cleanup")
    left = set(sql("select id::text from platform.sessions where id = any(cast(:i as uuid[]))", i=list(sid.values())).scalars())
    assert left == {sid["live"], sid["ended_recent"]}
    assert sql("select count(*) from platform.login_events").scalar() == before - 1
    assert job_row(sql, jid)["result"]["sessions"] == 2
    sql("delete from platform.sessions where id = any(cast(:i as uuid[]))", i=list(sid.values()))


def test_notification_and_job_history_are_pruned(sql, db):
    sql("insert into platform.notifications(id, title, category, audience, priority, status, source, created_at) values (gen_random_uuid(), 'old', 'general', '{}', 5, 'done', 'manual', now() - interval '100 days'), "
        "(gen_random_uuid(), 'new', 'general', '{}', 5, 'done', 'manual', now()), (gen_random_uuid(), 'old but still scheduled', 'general', '{}', 5, 'scheduled', 'manual', now() - interval '100 days')")
    sql("insert into platform.deliveries(notification_id, user_id, channel, status, attempts) select id, 10, 'inapp', 'stored', 0 from platform.notifications")
    run_kind(db, "notify.prune")
    assert sorted(sql("select title from platform.notifications").scalars()) == ["new", "old but still scheduled"] and sql("select count(*) from platform.deliveries").scalar() == 2
    sql("insert into platform.jobs(kind, status, attempts, max_attempts, priority, finished_at) values ('events.prune', 'done', 1, 3, 5, now() - interval '20 days'), ('events.prune', 'dead', 3, 3, 5, now() - interval '20 days'), "
        "('events.prune', 'dead', 3, 3, 5, now() - interval '70 days')")
    sql("insert into platform.alerts(rule, severity, message, count, resolved_at) values ('x', 'warning', 'm', 1, now() - interval '70 days'), ('y', 'warning', 'm', 1, null)")
    run_kind(db, "jobs.prune")
    assert sql("select status, count(*) from platform.jobs where kind = 'events.prune' group by 1").all() == [("dead", 1)]
    assert sql("select rule from platform.alerts").scalars().all() == ["y"]


def test_deleted_files_are_purged_by_the_job(client, as_user, sql, db, file_storage):
    h = as_user("SO01")
    f = client.post("/api/v1/files", files={"file": ("a.txt", b"hello")}, headers=h).json()
    key = sql("select storage_key from platform.files where id = cast(:i as uuid)", i=f["id"]).scalar()
    path = file_storage / key[:2] / key[2:4] / key
    client.delete(f"/api/v1/files/{f['id']}", headers=h)
    run_kind(db, "files.purge_deleted")
    assert path.exists()                                            # deleted today: still recoverable
    sql("update platform.files set deleted_at = now() - interval '8 days' where id = cast(:i as uuid)", i=f["id"])
    jid = run_kind(db, "files.purge_deleted")
    assert not path.exists() and job_row(sql, jid)["result"] == {"purged": 1}


# ---------- monitoring ----------
def test_alerts_open_once_tell_the_admin_once_escalate_and_close_by_themselves(client, admin, as_user, sql, db):
    assert monitor.run(db)["firing"] == 0
    db.commit()
    assert len(monitor.RULES) == 11
    sql("insert into platform.push_subscriptions(id, user_id, channel, endpoint, failures, active) values (900, 10, 'webpush', 'https://fcm.googleapis.com/x', 0, true)")
    nid = sql("insert into platform.notifications(id, title, category, audience, priority, status, source) values (gen_random_uuid(), 'stuck', 'general', '{}', 5, 'done', 'system') returning id").scalar()
    sql("insert into platform.deliveries(notification_id, user_id, channel, subscription_id, status, attempts, next_attempt_at) values (:n, 10, 'webpush', 900, 'queued', 0, now() - interval '20 minutes')", n=nid)
    out = monitor.run(db)
    db.commit()
    assert out["opened"] == ["notify.backlog"] and out["firing"] == 1
    a = client.get(f"{A}/alerts", headers=admin).json()["alerts"]
    assert len(a) == 1 and a[0]["severity"] == "warning" and "waiting 20 minutes" in a[0]["message"] and a[0]["count"] == 1
    told = lambda: sql("select title from public.notifications where user_id = 1 and (title like 'Warning:%' or title like 'Critical:%') order by id").scalars().all()  # noqa: E731
    assert told() == ["Warning: notify backlog"]
    assert monitor.run(db)["opened"] == []
    db.commit()
    assert client.get(f"{A}/alerts", headers=admin).json()["alerts"][0]["count"] == 2 and told() == ["Warning: notify backlog"]     # still one alert, and no second message
    sql("update platform.deliveries set next_attempt_at = now() - interval '2 hours'")
    monitor.run(db)
    db.commit()
    assert client.get(f"{A}/alerts", headers=admin).json()["alerts"][0]["severity"] == "critical" and told() == ["Warning: notify backlog", "Critical: notify backlog"]
    assert client.post(f"{A}/alerts/{a[0]['id']}/acknowledge", headers=as_user("GM01")).status_code == 403
    assert client.post(f"{A}/alerts/{a[0]['id']}/acknowledge", headers=admin).json()["acknowledged_at"] is not None
    sql("delete from platform.deliveries")
    out = monitor.run(db)
    db.commit()
    assert out["closed"] == ["notify.backlog"] and client.get(f"{A}/alerts", headers=admin).json()["alerts"] == []
    assert len(client.get(f"{A}/alerts?open_only=false", headers=admin).json()["alerts"]) == 1


def test_other_rules_fire_on_their_own_evidence(sql, db, monkeypatch):
    sql("insert into platform.jobs(kind, status, attempts, max_attempts, priority, finished_at) values ('events.prune', 'dead', 3, 3, 5, now())")
    sql("insert into platform.jobs(kind, status, attempts, max_attempts, priority, run_at) values ('notify.prune', 'queued', 0, 3, 5, now() - interval '45 minutes')")
    sql("insert into platform.login_events(outcome, login, at) select 'wrong_password', 'guess', now() from generate_series(1, 55)")
    monkeypatch.setattr(monitor.shutil, "disk_usage", lambda p: type("U", (), {"total": 100, "free": 2, "used": 98})())
    try:
        out = monitor.run(db)
        db.commit()
        assert set(out["opened"]) == {"jobs.failed", "jobs.late", "auth.failed_logins", "storage.disk"}
        got = dict(sql("select rule, severity || ': ' || message from platform.alerts").all())
        assert got["storage.disk"] == "critical: The disk that holds uploaded files is 98% full." and "events.prune (1)" in got["jobs.failed"] and "55 failed logins" in got["auth.failed_logins"]
    finally:
        sql("delete from platform.login_events where login = 'guess'")


def test_a_rule_that_crashes_is_reported_and_the_others_still_run(sql, db, monkeypatch):
    monkeypatch.setitem(monitor.RULES, "storage.disk", lambda db: 1 / 0)
    out = monitor.run(db)
    db.commit()
    assert out["opened"] == ["storage.disk"] and out["checked"] == len(monitor.RULES)
    assert "could not run" in sql("select message from platform.alerts").scalar()


def test_the_overview_shows_the_state_and_no_secrets(client, admin, as_user, sql, db):
    metrics.reset()
    for _ in range(3):
        client.get(f"/api/v1/files/{uuid.uuid4()}", headers=as_user("SO01"))
    client.get("/api/v1/nothing-here")
    m = client.get(f"{A}/monitor", headers=admin)
    d = m.json()
    assert set(d) >= {"database", "worker", "jobs", "notifications", "realtime", "storage", "api", "alerts", "configuration"}
    assert d["database"]["migrations"]["platform"]["up_to_date"] is True and d["realtime"]["listening"] is True and d["storage"]["disk_total_bytes"] > 0
    routes = {(r["method"], r["route"]): r for r in d["api"]["busiest"]}
    assert routes[("GET", "/api/v1/files/{file_id}")]["requests"] == 3 and routes[("GET", "/api/v1/files/{file_id}")]["client_errors"] == 3   # counted by pattern, not by id
    assert routes[("GET", "(no such route)")]["requests"] == 1
    s = get_settings()
    assert s.auth_secret not in m.text and "postgresql" not in m.text and d["configuration"]["channels"] == {"webpush": False, "apns": False, "email": False, "web_alert_rules": False}


def test_metrics_cannot_grow_without_limit():
    metrics.reset()
    for i in range(metrics.MAX_ROUTES + 50):
        metrics.record("GET", f"/r{i}", 200, 1.0)
    snap = metrics.snapshot(1000)
    assert len(snap["busiest"]) == metrics.MAX_ROUTES + 1 and snap["requests"] == metrics.MAX_ROUTES + 50
    metrics.reset()


# ---------- the worker ----------
def test_a_job_pass_schedules_and_runs(sql, db):
    svc.ensure_schedules(db)
    sql("update platform.schedules set next_run_at = now() - interval '1 second' where name in ('monitor', 'prune-jobs')")
    out = worker.job_tick()
    assert out["scheduled"] == 2 and sorted(r["kind"] for r in out["ran"]) == ["jobs.prune", "monitor.check"] and all(r["status"] == "done" for r in out["ran"])
    assert worker.job_tick() == {"ran": [], "scheduled": 0} or worker.job_tick()["ran"] == []


def test_the_worker_starts_and_stops_cleanly(sql):
    async def go():
        worker.start()
        await asyncio.sleep(0.6)
        assert worker.status()["running"] is True
        await worker.stop()
    before = dict(worker.state["notify"]), dict(worker.state["jobs"])
    asyncio.run(go())
    st = worker.status()
    assert st["running"] is False and st["notify"]["passes"] > before[0]["passes"] and st["jobs"]["passes"] > before[1]["passes"] and st["notify"]["last_error"] is None and st["jobs"]["last_error"] is None
    assert sql("select count(*) from platform.schedules").scalar() == 7       # the standard schedules were made at start


def test_the_super_admin_sees_who_is_logged_in_and_can_end_one_login(client, admin, as_user, sql):
    from tests.helpers import auth, login
    sql("delete from platform.rate_limits")
    t = login(client, "SO04", device={"installation_id": "phone-so04", "platform": "android", "model": "Pixel 8"}).json()
    h = auth(t["access_token"])
    assert client.get("/api/v1/auth/me", headers=h).status_code == 200
    assert client.get(f"{A}/sessions", headers=as_user("GM01")).status_code == 403
    d = client.get(f"{A}/sessions", headers=admin).json()
    mine = [s for s in d["sessions"] if s["user_code"] == "SO04"]
    assert len(mine) == 1 and mine[0]["client"] == "android" and mine[0]["device"] == "Pixel 8" and d["by_client"]["android"] >= 1
    assert "token" not in str(d).lower().replace("token_version", "")
    assert client.delete(f"{A}/sessions/{mine[0]['id']}", headers=as_user("GM01")).status_code == 403
    assert client.delete(f"{A}/sessions/{mine[0]['id']}", headers=admin).json() == {"ok": True}
    assert client.get("/api/v1/auth/me", headers=h).status_code == 401                       # the token stops at once
    assert client.post("/api/v1/auth/refresh", json={"refresh_token": t["refresh_token"]}).status_code == 401
    assert client.delete(f"{A}/sessions/{mine[0]['id']}", headers=admin).status_code == 404
    assert client.delete(f"{A}/sessions/not-an-id", headers=admin).status_code == 404
    assert not [s for s in client.get(f"{A}/sessions", headers=admin).json()["sessions"] if s["user_code"] == "SO04"]


def test_backup_alerts_only_in_production_and_follow_what_the_scripts_recorded(client, admin, sql, db, monkeypatch):
    from datetime import timedelta
    stamp = lambda **ago: (datetime.now(UTC) - timedelta(**ago)).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    put = lambda key, value: sql("insert into platform.settings(key, value, label) values (:k, :v, 'x') on conflict (key) do update set value = excluded.value", k=key, v=value)  # noqa: E731
    sql("delete from platform.settings where key like 'backup.%'")
    assert monitor._backup(db) is None                                  # not production: silent
    assert client.get(f"{A}/monitor", headers=admin).json()["backup"] == {"last": None, "verified": None}
    monkeypatch.setenv("PLATFORM_ENV", "production")
    get_settings.cache_clear()
    try:
        assert monitor._backup(db)[1].startswith("No backup has been made yet")
        put("backup.last", '{"at":"' + stamp(hours=2) + '","name":"b1","rows":10}')
        assert "test-restored yet" in monitor._backup(db)[1]
        put("backup.verified", '{"at":"' + stamp(hours=1) + '","name":"b1","ok":true}')
        assert monitor._backup(db) is None                              # a fresh backup that was restored and checked: all good
        put("backup.verified", '{"at":"' + stamp(days=10) + '","name":"b1","ok":true}')
        assert "for 10 days" in monitor._backup(db)[1]
        put("backup.verified", '{"at":"' + stamp(hours=1) + '","name":"b1","ok":false,"reason":"record counts differ"}')
        sev, msg, _ = monitor._backup(db)
        assert sev == "critical" and "record counts differ" in msg
        put("backup.last", '{"at":"' + stamp(hours=50) + '","name":"b0"}')
        assert monitor._backup(db)[0] == "warning" and "2 days 2 hours old" in monitor._backup(db)[1]
        put("backup.last", '{"at":"' + stamp(days=6) + '","name":"b0"}')
        assert monitor._backup(db)[0] == "critical"
        put("backup.last", "not json")
        assert monitor._backup(db)[1].startswith("No backup has been made yet")
    finally:
        monkeypatch.setenv("PLATFORM_ENV", "test")
        get_settings.cache_clear()
        sql("delete from platform.settings where key like 'backup.%'")


def test_one_bad_schedule_or_a_vanished_job_does_not_stop_the_others(sql, db, flaky):
    flaky["fail"] = False
    svc.ensure_schedules(db)
    sql("update platform.schedules set next_run_at = now() - interval '1 second', payload = '{\"keep_days\": 0}' where name = 'prune-events'")     # outside today's limits
    sql("update platform.schedules set next_run_at = now() - interval '1 second' where name = 'prune-jobs'")
    assert svc.schedule_due(db) == 1
    assert sql("select last_status from platform.schedules where name = 'prune-events'").scalar() == "dead"
    assert svc.run_one(db)["kind"] == "jobs.prune"
    # a job whose record disappears while it runs: the outcome has nowhere to go, and nothing breaks
    jid = svc.enqueue(db, "test.flaky")
    db.commit()

    def vanish(d, p):
        from sqlalchemy import text
        with session_factory()() as other:
            other.execute(text("delete from platform.jobs where id = :i"), {"i": jid})
            other.commit()
        return {"n": 1}
    svc.KINDS["test.flaky"].fn = vanish
    assert svc.run_one(db) == {"id": jid, "kind": "test.flaky", "status": "done"}
    assert svc.run_one(db) is None
