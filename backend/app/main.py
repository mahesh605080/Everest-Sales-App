from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import errors
from . import logging as applog
from .config import get_settings
from .db import dispose
from .middleware import Envelope
from .realtime import receipts, socket
from .realtime.hub import hub
from .routers import admin_db, admin_users, auth, data, health, realtime

API = "/api/v1"


def create_app() -> FastAPI:
    s = get_settings()
    applog.setup(s.log_level)

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        receipts.install()
        await hub.start()   # listens for committed events and forwards them to live connections
        yield
        await hub.stop()
        dispose()  # close database connections cleanly on shutdown

    app = FastAPI(title="Everest platform", version="0.1.0", lifespan=lifespan,
                  docs_url=f"{API}/docs" if s.env != "production" else None, redoc_url=None, openapi_url=f"{API}/openapi.json")
    errors.install(app)
    app.include_router(health.router, prefix=API)
    app.include_router(auth.router, prefix=API)
    app.include_router(admin_users.router, prefix=API)
    app.include_router(admin_db.router, prefix=API)
    app.include_router(data.router, prefix=API)
    app.include_router(realtime.router, prefix=API)
    app.include_router(socket.router)
    if s.origins:
        app.add_middleware(CORSMiddleware, allow_origins=s.origins, allow_credentials=True, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
                           allow_headers=["authorization", "content-type", "x-csrf-token", "idempotency-key"], max_age=600)
    app.add_middleware(Envelope, max_body=s.max_body_bytes, big_body_prefixes=(f"{API}/files",))
    return app


app = create_app()
