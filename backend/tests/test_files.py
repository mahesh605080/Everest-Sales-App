import io
import time
import zipfile

import pytest

from app.config import get_settings
from app.services import files as svc
from app.services.storage import LocalStorage, MemoryStorage, get_storage, set_storage

F = "/api/v1/files"
JPG = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 200 + b"\xff\xd9"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"
EXE = b"MZ\x90\x00\x03\x00\x00\x00" + b"\x00" * 200


def office(prefix="xl/", macro=False):
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", "<Types/>")
        z.writestr(f"{prefix}workbook.xml", "<x/>")
        if macro:
            z.writestr(f"{prefix}vbaProject.bin", b"macro")
    return buf.getvalue()


def up(client, h, name, data, **form):
    return client.post(F, files={"file": (name, data)}, data=form, headers=h)


@pytest.fixture(autouse=True)
def clean(sql):
    sql("delete from platform.files")
    sql("delete from platform.user_quotas")
    yield


def test_upload_download_roundtrip_and_metadata(client, as_user, sql, file_storage):
    h = as_user("SO01")
    r = up(client, h, "Cheque photo.JPG", JPG, folder="Collections/October", ref_type="collection", ref_id="42")
    f = r.json()
    assert r.status_code == 201 and f["name"] == "Cheque photo.JPG" and f["content_type"] == "image/jpeg" and f["size"] == len(JPG) and f["folder"] == "Collections/October" and f["mine"] is True
    key = sql("select storage_key from platform.files where id = :i", i=f["id"]).scalar()
    assert len(key) == 48 and "Cheque" not in key and (file_storage / key[:2] / key[2:4] / key).read_bytes() == JPG  # stored under a random name
    d = client.get(f"{F}/{f['id']}/download", headers=h)
    assert d.status_code == 200 and d.content == JPG and d.headers["content-type"] == "image/jpeg" and d.headers["content-disposition"].startswith("attachment") and d.headers["x-content-type-options"] == "nosniff"
    assert client.get(f"{F}/{f['id']}/download?inline=true", headers=h).headers["content-disposition"].startswith("inline")
    lst = client.get(f"{F}?ref_type=collection&ref_id=42", headers=h).json()
    assert lst["total"] == 1 and lst["quota"]["used_bytes"] == len(JPG) and lst["quota"]["files"] == 1
    assert client.get(F).status_code == 401 and client.post(F, files={"file": ("a.jpg", JPG)}).status_code == 401


def test_content_decides_the_type_not_the_name(client, as_user):
    h = as_user("SO01")
    refused = [("photo.jpg", EXE), ("report.pdf", JPG), ("page.txt", b"<html><script>alert(1)</script></html>"), ("logo.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>"),
               ("run.sh", b"#!/bin/sh\nrm -rf /\n"), ("data.txt", b"\x00\x01\x02binary"), ("macro.xlsx", office(macro=True)), ("fake.xlsx", b"PK\x03\x04not a real zip"),
               ("archive.zip", office()), ("noext", JPG), ("notes.csv", PNG)]
    for name, data in refused:
        r = up(client, h, name, data)
        assert r.status_code == 415 and r.json()["code"] == "unsupported_type", (name, r.status_code, r.text)
    accepted = [("a.png", PNG, "image/png"), ("b.pdf", PDF, "application/pdf"), ("c.xlsx", office(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                ("d.docx", office("word/"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document"), ("e.csv", "code,name\nD-1001,बारा फार्मा\n".encode(), "text/csv"), ("f.txt", b"plain notes", "text/plain")]
    for name, data, ctype in accepted:
        r = up(client, h, name, data)
        assert r.status_code == 201 and r.json()["content_type"] == ctype, (name, r.text)
    assert up(client, h, "empty.txt", b"").status_code == 422


def test_names_are_only_labels(client, as_user, sql, file_storage):
    h = as_user("SO01")
    count = lambda: sum(1 for p in file_storage.rglob("*") if p.is_file())  # noqa: E731
    before = count()
    r = up(client, h, "../../etc/passwd.txt", b"harmless", folder="../../../root/.ssh")
    f = r.json()
    assert r.status_code == 201 and f["name"] == "passwd.txt" and f["folder"] == "root/ssh"
    assert not (file_storage.parent / "etc").exists() and count() == before + 1  # exactly one new file, inside the storage directory
    assert up(client, h, 'bad<>:|?*name.txt', b"x").json()["name"] == "badname.txt"
    ren = client.patch(f"{F}/{f['id']}", json={"name": "..\\..\\windows\\notes.txt", "folder": "Visits/2083"}, headers=h).json()
    assert ren["name"] == "notes.txt" and ren["folder"] == "Visits/2083"
    assert client.patch(f"{F}/{f['id']}", json={"name": "notes.exe"}, headers=h).status_code == 422  # the ending must keep matching the content


def test_size_limit_and_quota(client, as_user, monkeypatch, file_storage):
    h = as_user("SO02")
    monkeypatch.setattr(get_settings(), "file_max_bytes", 5000)
    r = up(client, h, "big.txt", b"a" * 6000)
    assert r.status_code == 413 and r.json()["code"] == "too_large"
    assert not list(file_storage.rglob("*.part"))  # the half-written file is removed
    monkeypatch.setattr(get_settings(), "file_quota_bytes", 7000)
    assert up(client, h, "one.txt", b"a" * 4000).status_code == 201
    r = up(client, h, "two.txt", b"a" * 4000)
    assert r.status_code == 413 and r.json()["code"] == "quota_exceeded"
    f = client.get(F, headers=h).json()
    assert f["quota"] == {"limit_bytes": 7000, "used_bytes": 4000, "files": 1, "free_bytes": 3000}
    client.delete(f"{F}/{f['files'][0]['id']}", headers=h)
    assert up(client, h, "two.txt", b"a" * 4000).status_code == 201  # deleting frees the allowance


def test_private_by_default_and_sharing(client, as_user, sql):
    owner, other, asm = as_user("SO01"), as_user("SO02"), as_user("ASM01")
    f = up(client, owner, "price list.pdf", PDF).json()
    for h in (other, asm, as_user("GM01")):
        assert client.get(f"{F}/{f['id']}", headers=h).status_code == 404 and client.get(f"{F}/{f['id']}/download", headers=h).status_code == 404
    assert client.get(f"{F}/not-a-uuid", headers=owner).status_code == 404
    so2 = sql("select id from public.users where code = 'SO02'").scalar()
    sh = client.put(f"{F}/{f['id']}/shares", json={"user_ids": [so2]}, headers=owner)
    assert sh.status_code == 200 and sh.json()["shares"][0]["user_id"] == so2
    assert client.get(f"{F}/{f['id']}/download", headers=other).content == PDF and client.get(f"{F}/{f['id']}", headers=asm).status_code == 404
    assert client.get(f"{F}?scope=shared", headers=other).json()["total"] == 1 and client.get(f"{F}?scope=mine", headers=other).json()["total"] == 0
    for call in (lambda: client.delete(f"{F}/{f['id']}", headers=other), lambda: client.patch(f"{F}/{f['id']}", json={"folder": "x"}, headers=other),
                 lambda: client.put(f"{F}/{f['id']}/shares", json={"everyone": True}, headers=other)):
        assert call().status_code == 404  # seeing a file is not owning it
    client.put(f"{F}/{f['id']}/shares", json={"role_key": "asm"}, headers=owner)
    assert client.get(f"{F}/{f['id']}", headers=asm).status_code == 200 and client.get(f"{F}/{f['id']}", headers=other).status_code == 404  # the new list replaced the old
    assert client.put(f"{F}/{f['id']}/shares", json={"user_ids": [999999]}, headers=owner).status_code == 422
    client.put(f"{F}/{f['id']}/shares", json={}, headers=owner)
    assert client.get(f"{F}/{f['id']}", headers=asm).status_code == 404  # private again
    # the Super Admin holds files.manage
    assert client.get(f"{F}/{f['id']}", headers=as_user("ADMIN")).status_code == 200 and client.get(f"{F}?scope=all", headers=as_user("ADMIN")).json()["total"] == 1
    assert client.get(f"{F}?scope=all", headers=other).json()["total"] == 0  # "all" without the permission is just "mine"


def test_signed_link_works_without_login_then_expires(client, as_user, monkeypatch):
    owner = as_user("SO01")
    f = up(client, owner, "invoice.pdf", PDF).json()
    assert client.post(f"{F}/{f['id']}/link", json={"seconds": 600}, headers=as_user("SO02")).status_code == 404  # only someone who can see it can make a link
    link = client.post(f"{F}/{f['id']}/link", json={"seconds": 600}, headers=owner).json()
    assert link["expires_in"] == 600
    anon = client.get(link["path"])
    assert anon.status_code == 200 and anon.content == PDF and anon.headers["content-disposition"].startswith("attachment")
    head, sig = link["path"].rsplit(".", 1)
    assert client.get(f"{head}.{'A' * len(sig)}").status_code == 404  # wrong signature
    fid, exp = head.rsplit("/", 1)[1].rsplit(".", 1)
    assert client.get(f"{F}/signed/{fid}.{int(exp) + 99999}.{sig}").status_code == 404  # the expiry is part of what is signed
    assert client.get(f"{F}/signed/garbage").status_code == 404
    real = time.time
    monkeypatch.setattr(time, "time", lambda: real() + 601)
    assert client.get(link["path"]).status_code == 404  # expired
    monkeypatch.setattr(time, "time", real)
    client.delete(f"{F}/{f['id']}", headers=owner)
    assert client.get(link["path"]).status_code == 404  # deleting the file kills its links


def test_delete_history_and_purge(client, as_user, sql, db):
    owner = as_user("SO01")
    f = up(client, owner, "old.txt", b"old notes").json()
    client.get(f"{F}/{f['id']}/download", headers=owner)
    assert client.delete(f"{F}/{f['id']}", headers=owner).status_code == 200
    assert client.get(f"{F}/{f['id']}", headers=owner).status_code == 404 and client.get(F, headers=owner).json()["total"] == 0
    acts = [r[0] for r in sql("select action from platform.file_events where file_id = :i order by id", i=f["id"])]
    assert acts == ["uploaded", "downloaded", "deleted"]
    key = sql("select storage_key from platform.files where id = :i", i=f["id"]).scalar()
    assert get_storage().exists(key)  # kept for a while, so a mistake can be undone
    assert svc.purge_deleted(db, older_than_days=7) == 0
    sql("update platform.files set deleted_at = now() - interval '8 days' where id = :i", i=f["id"])
    assert svc.purge_deleted(db, older_than_days=7) == 1
    db.commit()
    assert not get_storage().exists(key) and sql("select purged_at is not null from platform.files where id = :i", i=f["id"]).scalar()


def test_usage_report_and_personal_allowance(client, as_user, sql):
    up(client, as_user("SO01"), "a.pdf", PDF)
    up(client, as_user("SO01"), "b.png", PNG)
    up(client, as_user("SO02"), "c.txt", b"hello")
    assert client.get("/api/v1/admin/files/usage", headers=as_user("GM01")).status_code == 403
    u = client.get("/api/v1/admin/files/usage", headers=as_user("ADMIN")).json()
    assert u["total"]["files"] == 3 and u["total"]["bytes"] == len(PDF) + len(PNG) + 5 and u["people"][0]["code"] == "SO01" and {t["content_type"] for t in u["by_type"]} == {"application/pdf", "image/png", "text/plain"}
    so2 = sql("select id from public.users where code = 'SO02'").scalar()
    q = client.put(f"/api/v1/admin/files/quota/{so2}", json={"bytes": 6}, headers=as_user("ADMIN")).json()
    assert q["limit_bytes"] == 6 and q["free_bytes"] == 1
    assert up(client, as_user("SO02"), "d.txt", b"too much").status_code == 413


def test_role_without_the_permission_cannot_upload(client, as_user, sql):
    sql("update public.roles set permissions = permissions - 'files.use' where key = 'so'")
    try:
        assert up(client, as_user("SO03"), "a.txt", b"x").status_code == 403
    finally:
        sql("""update public.roles set permissions = permissions || '["files.use"]'::jsonb where key = 'so'""")


def test_the_storage_backend_can_be_swapped(client, as_user):
    """Nothing but the adapter knows where bytes live: with an in-memory backend the same API works unchanged."""
    before = get_storage()
    mem = MemoryStorage()
    set_storage(mem)
    try:
        f = up(client, as_user("SO01"), "mem.txt", b"kept in memory").json()
        assert len(mem.blobs) == 1 and client.get(f"{F}/{f['id']}/download", headers=as_user("SO01")).content == b"kept in memory"
    finally:
        set_storage(before)
    assert isinstance(before, LocalStorage)
    with pytest.raises(ValueError):
        before.open("../../etc/passwd")  # the adapter itself refuses anything that is not one of its own keys
