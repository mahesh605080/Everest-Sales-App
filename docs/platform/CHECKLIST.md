# Platform implementation checklist

Tick only what has been built **and** tested. Each phase has a report in this folder.

- [x] **Phase 0 — Audit and protection.** `AUDIT.md`. Baseline: web 157/157, mobile 11/11. Work on branch `platform`.
- [x] **Phase 1 — Backend foundation.** FastAPI service in `backend/`, configuration, health, database, Alembic in schema `platform`, Docker entries. 9 tests. `REPORT-phase-1.md`.
- [x] **Phase 2 — Authentication, users, roles.** Access and refresh tokens, sessions, devices, reset codes, login history, Argon2id, level rule, web and mobile integrated. Backend 35 tests, web 175. `REPORT-phase-2.md`. Open: short token for the browser, MFA, email verification.
- [x] **Phase 3 — Data APIs and admin controls.** Document store with declared fields and rules, read-only database view. Backend 44 tests. `REPORT-phase-3.md`.
- [x] **Phase 4 — Realtime.** Event log with ordered ids, WebSockets, channel rules, replay, chat with receipts, presence; web and mobile clients. Backend 59 tests, web 179. `REPORT-phase-4.md`. One process only.
- [x] **Phase 5 — File storage.** Private files, content-based type check, quotas, sharing, signed links, history, swappable backend, web Files screen. Backend 69 tests, web 184. `REPORT-phase-5.md`.
- [x] **Phase 6 — Notifications.** Engine and queue with honest states, Web Push (VAPID, encrypted), APNs sender, device registry tied to the login, preferences, send screen, service worker, mobile integration, capability matrix (`NOTIFICATIONS.md`). Backend 104 tests, web 192, mobile 24. `REPORT-phase-6.md`. Not run against a real push service, Apple, or a real phone.
- [ ] **Phase 7 — Jobs and scheduler.** Worker, recurring jobs, history.
- [ ] **Phase 8 — Admin console and documentation.**
- [ ] **Phase 9 — Hardening, backup and restore, deployment.**
