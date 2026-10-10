import logging
import time
import uuid

from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import metrics

log = logging.getLogger("platform.request")

SECURITY_HEADERS = [
    (b"x-content-type-options", b"nosniff"), (b"x-frame-options", b"DENY"), (b"referrer-policy", b"no-referrer"),
    (b"cache-control", b"no-store"), (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"permissions-policy", b"geolocation=(), camera=(), microphone=()"),
]


class Flood:
    """A ceiling on how many requests one address may make in a minute. Kept in memory: it is a seat belt against a runaway script
    or a crude flood, not the login protection (that one is in the database and survives restarts)."""

    def __init__(self, per_minute: int, max_keys: int = 20000):
        self.limit, self.max_keys, self.window, self.counts = per_minute, max_keys, 0, {}

    def allow(self, key: str) -> bool:
        if self.limit <= 0:
            return True
        w = int(time.time() // 60)
        if w != self.window or len(self.counts) > self.max_keys:
            self.window, self.counts = w, {}
        n = self.counts[key] = self.counts.get(key, 0) + 1
        return n <= self.limit


class Envelope:
    """Request id, body size limit, flood limit, security headers and one structured log line per request. Plain ASGI so it also sees streamed bodies."""

    def __init__(self, app: ASGIApp, max_body: int, big_bodies: dict[tuple[str, str], int] | None = None, per_minute: int = 0, trusted_proxy: bool = True):
        # big_bodies: the few exact (method, path) pairs that may carry more than max_body, each with its own ceiling. Everything else gets max_body,
        # and the ceiling is applied while the body is read, before any login check or handler runs.
        self.app, self.max_body, self.big, self.flood, self.trusted = app, max_body, big_bodies or {}, Flood(per_minute), trusted_proxy

    def _address(self, scope: Scope, headers: dict) -> str:
        fwd = [p.strip() for p in headers.get(b"x-forwarded-for", b"").decode("latin-1").split(",") if p.strip()] if self.trusted else []
        ip = fwd[-1] if fwd else (scope["client"][0] if scope.get("client") else "unknown")
        if ":" in ip:   # one IPv6 customer holds a whole /64; count them as one address
            ip = ":".join(ip.split("%")[0].split(":")[:4])
        return ip

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        rid = uuid.uuid4().hex[:16]
        scope.setdefault("state", {})["request_id"] = rid
        started, status, path = time.perf_counter(), 500, scope["path"]
        limit = self.big.get((scope["method"], path.rstrip("/") or "/"), self.max_body)
        headers = dict(scope["headers"])
        seen = 0

        async def reject(code: int, text: bytes, extra: list | None = None):
            nonlocal status
            status = code
            await send({"type": "http.response.start", "status": code, "headers": [(b"content-type", b"application/json"), (b"x-request-id", rid.encode()), *(extra or []), *SECURITY_HEADERS]})
            await send({"type": "http.response.body", "body": text})

        if path != "/api/v1/health" and not self.flood.allow(self._address(scope, headers)):   # only the bare "am I alive" answer is exempt; it touches nothing
            await reject(429, b'{"error":"Too many requests. Wait a minute and try again.","code":"rate_limited"}', [(b"retry-after", b"60")])
        elif _length(headers) > limit:
            await reject(413, b'{"error":"The request is too large.","code":"too_large"}')
        else:
            async def limited() -> Message:
                nonlocal seen
                m = await receive()
                if m["type"] == "http.request":
                    seen += len(m.get("body", b""))
                    if seen > limit:
                        raise _TooLarge()
                return m

            async def wrapped(m: Message):
                nonlocal status
                if m["type"] == "http.response.start":
                    status = m["status"]
                    m = {**m, "headers": [*m.get("headers", []), (b"x-request-id", rid.encode()), *[h for h in SECURITY_HEADERS if h[0] not in dict(m.get("headers", []))]]}
                await send(m)

            try:
                await self.app(scope, limited, wrapped)
            except _TooLarge:
                await reject(413, b'{"error":"The request is too large.","code":"too_large"}')
        ms = (time.perf_counter() - started) * 1000
        metrics.record(scope["method"], _pattern(scope), status, ms)
        if path != "/api/v1/health":
            log.info("request", extra={"request_id": rid, "method": scope["method"], "path": path, "status": status, "ms": round((time.perf_counter() - started) * 1000, 1)})


def _length(headers: dict) -> int:
    try:
        return int(headers.get(b"content-length", b"0") or 0)
    except ValueError:
        return 1 << 62   # a length that is not a number is treated as too large


def _pattern(scope: Scope) -> str:
    """The route as a pattern (/api/v1/files/{file_id}), never the raw path, so ids do not create endless rows."""
    if scope.get("route") is None:
        return "(no such route)"
    parts = scope["path"].split("/")
    for name, value in (scope.get("path_params") or {}).items():
        v = str(value)
        if v in parts:
            parts[parts.index(v)] = "{" + name + "}"
    return "/".join(parts)


class _TooLarge(Exception):
    pass
