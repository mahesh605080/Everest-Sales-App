"""One error shape for every response, the same the web app's API uses: {"error": "<message>", "code": "<machine code>"}."""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import DataError
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("platform")


class ApiError(Exception):
    def __init__(self, status: int, message: str, code: str = "error", fields: dict | None = None):
        self.status, self.message, self.code, self.fields = status, message, code, fields


def _body(request: Request, message: str, code: str, fields: dict | None = None):
    out = {"error": message, "code": code, "request_id": getattr(request.state, "request_id", None)}
    if fields:
        out["fields"] = fields
    return out


def install(app: FastAPI):
    @app.exception_handler(ApiError)
    async def _api(request: Request, e: ApiError):
        return JSONResponse(_body(request, e.message, e.code, e.fields), status_code=e.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, e: StarletteHTTPException):
        code = {401: "unauthenticated", 403: "forbidden", 404: "not_found", 405: "method_not_allowed"}.get(e.status_code, "error")
        return JSONResponse(_body(request, str(e.detail), code), status_code=e.status_code, headers=getattr(e, "headers", None))

    @app.exception_handler(RequestValidationError)
    async def _validation(request: Request, e: RequestValidationError):
        fields = {".".join(str(p) for p in err["loc"] if p not in ("body", "query", "path")): err["msg"] for err in e.errors()}
        first = next(iter(fields.items()), ("", "The request is not valid."))
        return JSONResponse(_body(request, f"{first[0]}: {first[1]}".strip(": "), "invalid_request", fields), status_code=422)

    @app.exception_handler(DataError)
    async def _unstorable(request: Request, e: DataError):
        # Text the database cannot hold (a zero byte, a number out of range ...). The caller's mistake, not a fault here.
        return JSONResponse(_body(request, "The request contains a value that cannot be stored.", "invalid_request"), status_code=422)

    @app.exception_handler(Exception)
    async def _crash(request: Request, e: Exception):
        # The person sees no detail; the log has it, keyed by the request id they can quote.
        log.exception("unhandled error", extra={"request_id": getattr(request.state, "request_id", None), "path": request.url.path})
        return JSONResponse(_body(request, "Something went wrong on the server. Please try again.", "server_error"), status_code=500)
