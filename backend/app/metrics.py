"""Counts requests per route in memory. Cheap, lost on restart, and per process: enough to see what is slow or failing right now."""
import threading
import time

_lock = threading.Lock()
_routes: dict[tuple[str, str], list[float]] = {}  # (method, route) -> [count, 4xx, 5xx, total ms, max ms]
started_at = time.time()
MAX_ROUTES = 500


def record(method: str, route: str, status: int, ms: float) -> None:
    with _lock:
        key = (method, route)
        r = _routes.get(key)
        if r is None:
            if len(_routes) >= MAX_ROUTES:   # never grow without limit, whatever is requested
                key = ("*", "(other)")
                r = _routes.get(key)
            if r is None:
                r = _routes[key] = [0, 0, 0, 0.0, 0.0]
        r[0] += 1
        r[1] += 400 <= status < 500
        r[2] += status >= 500
        r[3] += ms
        r[4] = max(r[4], ms)


def snapshot(top: int = 40) -> dict:
    with _lock:
        rows = [{"method": m, "route": p, "requests": int(r[0]), "client_errors": int(r[1]), "server_errors": int(r[2]), "avg_ms": round(r[3] / r[0], 1) if r[0] else 0, "max_ms": round(r[4], 1)} for (m, p), r in _routes.items()]
    total = sum(r["requests"] for r in rows)
    return {"since": started_at, "uptime_seconds": int(time.time() - started_at), "requests": total, "server_errors": sum(r["server_errors"] for r in rows), "client_errors": sum(r["client_errors"] for r in rows),
            "slowest": sorted(rows, key=lambda r: -r["avg_ms"])[:top], "busiest": sorted(rows, key=lambda r: -r["requests"])[:top]}


def reset() -> None:
    global started_at
    with _lock:
        _routes.clear()
        started_at = time.time()
