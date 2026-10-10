import pytest

D = "/api/v1/data"
NOTES = {"name": "visit_notes", "label": "Visit notes", "read_rule": "owner", "write_rule": "owner", "max_docs_per_user": 5, "max_doc_bytes": 600, "audited": True,
         "fields": [{"name": "title", "type": "string", "required": True, "max": 60}, {"name": "body", "type": "text"}, {"name": "priority", "type": "integer"},
                    {"name": "amount", "type": "number"}, {"name": "due", "type": "date"}, {"name": "status", "type": "enum", "options": ["open", "done"]},
                    {"name": "urgent", "type": "boolean"}, {"name": "extra", "type": "json"}]}


@pytest.fixture()
def notes(client, as_user, sql):
    sql("delete from platform.documents")
    sql("delete from platform.collections")
    assert client.put("/api/v1/admin/collections", json=NOTES, headers=as_user("ADMIN")).status_code == 200
    return NOTES


def test_only_the_super_admin_defines_collections(client, as_user, sql):
    sql("delete from platform.documents")
    sql("delete from platform.collections")
    assert client.put("/api/v1/admin/collections", json=NOTES, headers=as_user("GM01")).status_code == 403
    assert client.put("/api/v1/admin/collections", json=NOTES).status_code == 401
    bad = [{**NOTES, "name": "Bad Name"}, {**NOTES, "fields": []}, {**NOTES, "fields": [{"name": "x", "type": "blob"}]}, {**NOTES, "fields": [{"name": "a", "type": "enum"}]},
           {**NOTES, "write_rule": "authenticated"}, {**NOTES, "read_rule": "drop table"}, {**NOTES, "fields": [{"name": "a", "type": "string"}, {"name": "a", "type": "string"}]}]
    for b in bad:
        assert client.put("/api/v1/admin/collections", json=b, headers=as_user("ADMIN")).status_code == 422, b
    assert client.put("/api/v1/admin/collections", json=NOTES, headers=as_user("ADMIN")).status_code == 200
    assert [c["name"] for c in client.get(D, headers=as_user("SO01")).json()["collections"]] == ["visit_notes"]


def test_create_validates_every_field(client, as_user, notes):
    h = as_user("SO01")
    ok = client.post(f"{D}/visit_notes", json={"title": "Call back", "priority": 2, "amount": 10.5, "due": "2026-11-01", "status": "open", "urgent": True, "extra": {"a": [1, 2]}}, headers=h)
    assert ok.status_code == 201 and ok.json()["version"] == 1 and ok.json()["data"]["due"] == "2026-11-01"
    wrong = [{}, {"title": 5}, {"title": "x" * 61}, {"title": "a", "priority": "2"}, {"title": "a", "priority": True}, {"title": "a", "amount": "ten"}, {"title": "a", "due": "01/11/2026"},
             {"title": "a", "due": "2026-13-01"}, {"title": "a", "status": "closed"}, {"title": "a", "urgent": "yes"}, {"title": "a", "unknown": 1}, {"title": None}]
    for w in wrong:
        r = client.post(f"{D}/visit_notes", json=w, headers=h)
        assert r.status_code == 422 and r.json()["code"] == "invalid_request", (w, r.text)
    assert client.post(f"{D}/visit_notes", json=["not", "an", "object"], headers=h).status_code == 422
    assert client.post(f"{D}/nope", json={"title": "a"}, headers=h).status_code == 404


def test_size_and_count_limits(client, as_user, notes):
    h = as_user("SO02")
    assert client.post(f"{D}/visit_notes", json={"title": "big", "body": "x" * 700}, headers=h).status_code == 413
    for i in range(5):
        assert client.post(f"{D}/visit_notes", json={"title": f"n{i}"}, headers=h).status_code == 201
    r = client.post(f"{D}/visit_notes", json={"title": "one too many"}, headers=h)
    assert r.status_code == 409 and r.json()["code"] == "quota_exceeded"


def test_owner_rule_hides_other_peoples_documents(client, as_user, notes):
    mine = client.post(f"{D}/visit_notes", json={"title": "mine"}, headers=as_user("SO01")).json()
    theirs = client.post(f"{D}/visit_notes", json={"title": "theirs"}, headers=as_user("SO02")).json()
    lst = client.get(f"{D}/visit_notes", headers=as_user("SO01")).json()
    assert lst["total"] == 1 and lst["items"][0]["id"] == mine["id"]
    for call in (client.get, client.delete):
        assert call(f"{D}/visit_notes/{theirs['id']}", headers=as_user("SO01")).status_code == 404  # not 403: its existence is not revealed
    assert client.patch(f"{D}/visit_notes/{theirs['id']}", json={"title": "hacked"}, headers=as_user("SO01")).status_code == 404
    assert client.get(f"{D}/visit_notes/not-a-uuid", headers=as_user("SO01")).status_code == 404
    assert client.get(f"{D}/visit_notes/{theirs['id']}", headers=as_user("GM01")).status_code == 404  # a manager is not the owner either
    # the Super Admin holds data.manage and sees everything
    assert client.get(f"{D}/visit_notes", headers=as_user("ADMIN")).json()["total"] == 2
    assert client.get(f"{D}/visit_notes?mine=true", headers=as_user("ADMIN")).json()["total"] == 0


def test_permission_rules(client, as_user, sql):
    sql("delete from platform.documents")
    sql("delete from platform.collections")
    spec = {"name": "price_notes", "label": "Price notes", "read_rule": "authenticated", "write_rule": "schemes.edit", "fields": [{"name": "text", "type": "string", "required": True}]}
    assert client.put("/api/v1/admin/collections", json=spec, headers=as_user("ADMIN")).status_code == 200
    assert client.post(f"{D}/price_notes", json={"text": "by so"}, headers=as_user("SO01")).status_code == 403  # no schemes.edit
    d = client.post(f"{D}/price_notes", json={"text": "by gm"}, headers=as_user("GM01"))
    assert d.status_code == 201
    assert client.get(f"{D}/price_notes", headers=as_user("SO01")).json()["total"] == 1  # everyone may read
    assert client.patch(f"{D}/price_notes/{d.json()['id']}", json={"text": "x"}, headers=as_user("SO01")).status_code == 403
    spec2 = {**spec, "name": "manager_notes", "read_rule": "sales.view", "write_rule": "owner"}
    client.put("/api/v1/admin/collections", json=spec2, headers=as_user("ADMIN"))
    doc = client.post(f"{D}/manager_notes", json={"text": "from the field"}, headers=as_user("SO01")).json()
    assert client.get(f"{D}/manager_notes/{doc['id']}", headers=as_user("ASM01")).status_code == 200  # has sales.view
    assert client.get(f"{D}/manager_notes/{doc['id']}", headers=as_user("SO02")).status_code == 404  # has not
    assert client.patch(f"{D}/manager_notes/{doc['id']}", json={"text": "edited by manager"}, headers=as_user("ASM01")).status_code == 403  # may read, not write


def test_update_merges_checks_versions_and_keeps_required(client, as_user, notes, sql):
    h = as_user("SO03")
    d = client.post(f"{D}/visit_notes", json={"title": "first", "priority": 1}, headers=h).json()
    u = client.patch(f"{D}/visit_notes/{d['id']}?if_version=1", json={"priority": 5, "status": "done"}, headers=h).json()
    assert u["version"] == 2 and u["data"] == {**d["data"], "priority": 5, "status": "done"} and u["data"]["title"] == "first"
    stale = client.patch(f"{D}/visit_notes/{d['id']}?if_version=1", json={"priority": 9}, headers=h)
    assert stale.status_code == 409 and stale.json()["code"] == "version_conflict"
    assert client.patch(f"{D}/visit_notes/{d['id']}", json={"title": None}, headers=h).status_code == 422
    assert client.patch(f"{D}/visit_notes/{d['id']}", json={"priority": None}, headers=h).json()["data"]["priority"] is None  # an optional field can be cleared
    assert client.delete(f"{D}/visit_notes/{d['id']}", headers=h).status_code == 200
    assert client.get(f"{D}/visit_notes/{d['id']}", headers=h).status_code == 404
    acts = [r[0] for r in sql("select action from public.audit_logs where entity = 'doc:visit_notes' and entity_id = :i order by id", i=d["id"])]
    assert acts == ["create", "update", "update", "delete"]  # an audited collection leaves a trail


def test_filter_sort_search_and_paging(client, as_user, sql):
    sql("delete from platform.documents")
    sql("delete from platform.collections")
    spec = {**NOTES, "name": "tasks", "max_docs_per_user": 100, "audited": False}
    client.put("/api/v1/admin/collections", json=spec, headers=as_user("ADMIN"))
    h = as_user("SO04")
    for i in range(12):
        client.post(f"{D}/tasks", json={"title": f"Task {i:02d}", "body": "call the distributor" if i % 3 == 0 else "send a quote", "priority": i, "amount": i * 1.5, "due": f"2026-11-{i + 1:02d}",
                                        "status": "done" if i % 2 else "open", "urgent": i > 8}, headers=h)
    get = lambda qs: client.get(f"{D}/tasks?{qs}", headers=h).json()  # noqa: E731
    assert get("f.status=open")["total"] == 6 and get("f.status=open&f.urgent=true")["total"] == 1
    assert get("f.priority.gte=10")["total"] == 2 and get("f.priority.lt=3")["total"] == 3 and get("f.amount.lte=3")["total"] == 3
    assert get("f.due.gte=2026-11-10")["total"] == 3 and get("f.priority.in=1,2,3")["total"] == 3
    assert get("q=distributor")["total"] == 4 and get("q=100%25")["total"] == 0  # the % is taken literally
    page = get("sort=-priority&limit=5&offset=5")
    assert [x["data"]["priority"] for x in page["items"]] == [6, 5, 4, 3, 2] and page["total"] == 12 and page["limit"] == 5
    assert [x["data"]["title"] for x in get("sort=title&limit=2")["items"]] == ["Task 00", "Task 01"]
    for bad in ("f.nope=1", "f.priority.like=1", "f.extra=1", "sort=body", "sort=nope", "f.priority=abc", "f.title';drop table x;--=1"):
        assert client.get(f"{D}/tasks?{bad}", headers=h).status_code == 422, bad
    assert client.get(f"{D}/tasks?limit=1000", headers=h).status_code == 422
    assert sql("select count(*) from platform.documents").scalar() == 12  # and nothing was dropped


def test_collection_fields_can_grow_but_not_change_type(client, as_user, notes):
    h = as_user("SO05")
    d = client.post(f"{D}/visit_notes", json={"title": "kept"}, headers=h).json()
    more = {**NOTES, "fields": [*NOTES["fields"], {"name": "customer", "type": "string"}]}
    assert client.put("/api/v1/admin/collections", json=more, headers=as_user("ADMIN")).status_code == 200
    assert client.patch(f"{D}/visit_notes/{d['id']}", json={"customer": "D-1001"}, headers=h).json()["data"]["customer"] == "D-1001"
    retyped = {**NOTES, "fields": [{"name": "title", "type": "integer", "required": True}]}
    assert client.put("/api/v1/admin/collections", json=retyped, headers=as_user("ADMIN")).status_code == 422
    newreq = {**NOTES, "fields": [*NOTES["fields"], {"name": "must", "type": "string", "required": True}]}
    assert client.put("/api/v1/admin/collections", json=newreq, headers=as_user("ADMIN")).status_code == 422
    assert client.delete("/api/v1/admin/collections/visit_notes", headers=as_user("ADMIN")).status_code == 200
    assert client.get(f"{D}/visit_notes", headers=h).status_code == 404


def test_database_view_is_read_only_masked_and_for_the_super_admin(client, as_user):
    assert client.get("/api/v1/admin/db/overview", headers=as_user("GM01")).status_code == 403
    o = client.get("/api/v1/admin/db/overview", headers=as_user("ADMIN")).json()
    names = {(t["schema"], t["table"]) for t in o["tables"]}
    assert ("public", "users") in names and ("platform", "sessions") in names and o["migrations"]["platform"]["up_to_date"] and o["database_bytes"] > 0
    idx = client.get("/api/v1/admin/db/indexes", headers=as_user("ADMIN")).json()["indexes"]
    assert any(i["index"] == "documents_data_gin" for i in idx)
    u = client.get("/api/v1/admin/db/tables/public/users?limit=3", headers=as_user("ADMIN")).json()
    assert len(u["rows"]) == 3 and "password_hash" not in u["rows"][0] and next(c for c in u["columns"] if c["column_name"] == "password_hash")["hidden"] is True
    rt = client.get("/api/v1/admin/db/tables/platform/refresh_tokens", headers=as_user("ADMIN")).json()
    assert rt["rows"] and "token_hash" not in rt["rows"][0]
    for path in ("pg_catalog/pg_shadow", "public/nope", 'public/users";drop table users;--', "information_schema/tables"):
        assert client.get(f"/api/v1/admin/db/tables/{path}", headers=as_user("ADMIN")).status_code == 404, path
    assert client.post("/api/v1/admin/db/tables/public/users", headers=as_user("ADMIN")).status_code == 405  # there is no way to write
