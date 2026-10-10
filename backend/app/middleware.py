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


class Envelope:
    """Request id, body size limit, security headers and one structured log line per request. Plain ASGI so it also sees streamed bodies."""

    def __init__(self, app: ASGIApp, max_body: int, big_body_prefixes: tuple[str, ...] = ()):
        self.app, self.max_body, self.big = app, max_body, big_body_prefixes

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        rid = uuid.uuid4().hex[:16]
        scope.setdefault("state", {})["request_id"] = rid
        started, status, path = time.perf_counter(), 500, scope["path"]
        limit = None if path.startswith(self.big) and self.big else self.max_body
        headers = dict(scope["headers"])
        seen = 0

        async def reject(code: int, text: bytes):
            nonlocal status
            status = code
            await send({"type": "http.response.start", "status": code, "headers": [(b"content-type", b"application/json"), (b"x-request-id", rid.encode()), *SECURITY_HEADERS]})
            await send({"type": "http.response.body", "body": text})

        if limit is not None and int(headers.get(b"content-length", b"0") or 0) > limit:
            await reject(413, b'{"error":"The request is too large.","code":"too_large"}')
        else:
            async def limited() -> Message:
                nonlocal seen
                m = await receive()
                if m["type"] == "http.request" and limit is not None:
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
