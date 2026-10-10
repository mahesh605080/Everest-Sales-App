import json
import logging
import sys
from datetime import UTC, datetime

# Never put these in a log line, whatever a caller passes in "extra".
_SECRET_KEYS = {"password", "token", "refresh_token", "access_token", "authorization", "secret", "cookie", "p256dh", "auth"}


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {"at": datetime.now(UTC).isoformat(timespec="milliseconds"), "level": record.levelname, "logger": record.name, "msg": record.getMessage()}
        for k, v in record.__dict__.items():
            if k in logging.LogRecord("", 0, "", 0, "", (), None).__dict__ or k in ("message", "asctime"):
                continue
            out[k] = "[hidden]" if k.lower() in _SECRET_KEYS else v
        if record.exc_info:
            out["exc"] = self.formatException(record.exc_info)
        return json.dumps(out, default=str)


def setup(level: str):
    h = logging.StreamHandler(sys.stdout)
    h.setFormatter(JsonFormatter())
    root = logging.getLogger()
    root.handlers[:] = [h]
    root.setLevel(level.upper())
    logging.getLogger("uvicorn.access").disabled = True  # our own request log line replaces it
