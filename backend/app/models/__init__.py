"""Tables owned by the platform service. Import every model module here so Alembic sees it."""
from . import auth, data, files, meta, notify, realtime  # noqa: F401
