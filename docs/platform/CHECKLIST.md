# Platform implementation checklist

Tick only what has been built **and** tested. Each phase has a report in this folder.

- [x] **Phase 0 — Audit and protection.** `AUDIT.md`. Baseline: web 157/157, mobile 11/11. Work on branch `platform`.
- [x] **Phase 1 — Backend foundation.** FastAPI service in `backend/`, configuration, health, database, Alembic in schema `platform`, Docker entries. 9 tests. `REPORT-phase-1.md`.
- [ ] **Phase 2 — Authentication, users, roles.** Access and refresh tokens, sessions, devices, reset tokens, login history, Argon2id, role guard.
- [ ] **Phase 3 — Data APIs and admin controls.** Versioned API, document store, schema and migration view.
- [ ] **Phase 4 — Realtime.** WebSockets, channels, event log and recovery, chat, presence.
- [ ] **Phase 5 — File storage.** Upload, download, quotas, type checks, signed links.
- [ ] **Phase 6 — Notifications.** Engine and queue, Web Push, device registry, mobile integration, capability matrix.
- [ ] **Phase 7 — Jobs and scheduler.** Worker, recurring jobs, history.
- [ ] **Phase 8 — Admin console and documentation.**
- [ ] **Phase 9 — Hardening, backup and restore, deployment.**
