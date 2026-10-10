"""Tables owned by the platform service. Import every model module here so Alembic sees it."""
from . import auth, data, files, jobs, meta, notify, realtime  # noqa: F401
