"""Writes docs/platform/API-REFERENCE.md from the service's own route table, so the list cannot drift from the code.
Run:  cd backend && DATABASE_URL=postgresql://x/y PLATFORM_ENV=test PLATFORM_WORKER=0 .venv/bin/python -m scripts.api_doc"""
from pathlib import Path

from app.main import create_app

GROUPS = [("health", "Health"), ("auth", "Login and sessions"), ("admin: accounts", "People administration"), ("data", "Document store"), ("realtime and chat", "Live updates and chat"), ("files", "Files"),
          ("notifications", "Notifications and push"), ("admin: operations", "Operations (Super Admin)"), ("admin: database", "Database view (Super Admin)")]


def main():
    spec = create_app().openapi()
    by_tag: dict[str, list[tuple[str, str, str]]] = {}
    for path, methods in sorted(spec["paths"].items()):
        for method, op in methods.items():
            tag = (op.get("tags") or ["other"])[0]
            by_tag.setdefault(tag, []).append((method.upper(), path, (op.get("summary") or "").replace("|", "\\|")))
    out = ["# API reference", "", "Generated from the service's route table by `backend/scripts/api_doc.py`. Do not edit by hand.",
           "The same list, with request and response shapes and a try-it page, is served at `/api/v1/docs` when the service is not in production mode, and as OpenAPI JSON at `/api/v1/openapi.json`.", ""]
    known = [t for t, _ in GROUPS]
    for tag, title in GROUPS + [(t, t.title()) for t in sorted(by_tag) if t not in known]:
        rows = by_tag.get(tag)
        if not rows:
            continue
        out += [f"## {title}", "", "| Method | Path | What it does |", "|---|---|---|"]
        out += [f"| {m} | `{p}` | {s} |" for m, p, s in rows]
        out.append("")
    out += ["## Live connection", "", "| | Path | |", "|---|---|---|", "| WebSocket | `/ws` | See `INTEGRATION.md` for the messages. |", ""]
    target = Path(__file__).resolve().parents[2] / "docs" / "platform" / "API-REFERENCE.md"
    target.write_text("\n".join(out))
    print(f"{sum(len(v) for v in by_tag.values())} endpoints written to {target}")


if __name__ == "__main__":
    main()
