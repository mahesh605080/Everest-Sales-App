PW = "Everest@123"


def login(client, code="SO01", pw=PW, device=None, ip="10.0.0.1"):
    return client.post("/api/v1/auth/login", json={"login": code, "password": pw, **({"device": device} if device else {})}, headers={"x-forwarded-for": ip})


def auth(tok):
    return {"authorization": f"Bearer {tok}"}


def token(client, code="SO01"):
    r = login(client, code)
    assert r.status_code == 200, r.text
    return auth(r.json()["access_token"])
