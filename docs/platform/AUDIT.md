# Phase 0 — Audit of the existing system

Audited on 2026-10-10, before any platform code was written. Baseline branch: `main` at `71e672d`; platform work is on branch `platform`.

## 1. Existing architecture

| Part | What it is |
| --- | --- |
| Web app and API | One Next.js 15 (App Router, React 19, TypeScript) application. Screens in `app/(console)`, 59 JSON API routes in `app/api`. Node.js 22, npm |
| Database | PostgreSQL 16, 46 tables in schema `public`. Accessed only from the server through `pg` (`lib/db.ts`). 21 plain-SQL migrations in `db/migrations`, applied in order by `scripts/migrate.ts`, recorded in `schema_migrations` |
| Mobile app | Separate repository `Everest-Sales-app-Mobile`: React Native (Expo SDK 57, TypeScript), Android and iOS from one codebase. Not yet installed on a real device |
| Shared backend | Yes. The mobile app calls the same `/api/*` routes as the browser, with `Authorization: Bearer <token>` |
| Authentication | Own implementation: bcrypt password hashes in `users.password_hash`; one HS256 JWT valid 30 days (`lib/auth.ts`), in an HttpOnly SameSite=Lax cookie for the browser and as a bearer token for the phone; `users.token_version` ends every session of a person at once; lockout after 5 wrong passwords; per-address limit in memory |
| Authorisation | Roles with permissions stored as data (`roles.permissions` JSON), levels 1–5, territory rule on every list. Checked on the server in every route (`need(perm)`) |
| Notifications | In-app only: a `notifications` table and a bell that asks the server when the screen is opened. No push of any kind |
| Realtime | None. Screens reload on focus or on a timer |
| Files | Photos are stored as bytes in the `photos` table; there is no general file store |
| Background work | None of its own. Alert rules run when someone opens a screen, or when an outside scheduler calls `/api/cron/alerts` |
| Deployment | `docker-compose.yml` (PostgreSQL, app, Caddy for https) and `Dockerfile`. Written, never run. No hosting exists yet |
| Managed services | None. No Firebase, Firestore, Supabase, Appwrite or PocketBase anywhere in either repository |

## 2. Existing working features (must keep working)
Masters with Excel import/export; roles and permissions; visits with geo-fence and mock-location flag; tour plan; booklets with approval levels; sales orders with credit check, schemes, price lists, near-expiry lots, FEFO and dispatch; credit control; collections; claims with returns policy; distributor stock, suggested order, transfers; expiry position, demand plan, short stock; rebate; action list; approvals inbox; targets and scorecard; 25 Excel reports; alerts; audit log; mobile app screens with offline queue.

**Baseline test results, run before any change:** web end-to-end suite 157 passed, 0 failed; web type check clean; mobile type check clean; mobile unit tests 11 passed. There were no existing failures.

## 3. What is missing, measured against the platform brief

| Area | Today | Gap |
| --- | --- | --- |
| Token lifetime | One 30-day token | Short access token, rotating refresh token, reuse detection |
| Sessions and devices | Not tracked | List, revoke one, revoke all, device registry |
| Password hash | bcrypt cost 10 | Argon2id (keep verifying old bcrypt hashes) |
| Password reset | Admin types a new password | Single-use expiring reset token; email when SMTP is configured |
| Login history | Only "login" rows in the audit log | Dedicated history with device and address, including failures |
| Role safety | An admin-level user can edit any role | Nobody may grant a role at or above their own level except the Super Admin |
| Data API | Purpose-built routes | Versioned `/api/v1`, generic document store, admin view of schema and migrations |
| Realtime | None | Authenticated WebSockets, channels, missed-event recovery, chat |
| Files | Photos in the database | File service with quotas, type checks, signed downloads |
| Push | None | Notification engine, Web Push (VAPID), device registry, delivery log |
| Jobs | None | Scheduler and worker with history |
| Admin console | Roles, settings, audit log | Health, sessions, queue, jobs, storage, metrics |
| Backup | A documented `pg_dump` line | Scripts for backup and a tested restore |

## 4. Risks and dependencies
- **Two languages.** The brief asks for Python/FastAPI; the working system is TypeScript. Rewriting 59 routes would risk every working feature for no gain. **Decision: add a Python service beside the Next.js app, on the same PostgreSQL, and move nothing.** New platform capabilities live in Python; business routes stay where they are.
- **One database, two migration tools.** Alembic and the existing SQL runner must not both own the same tables. **Decision: Alembic owns a separate schema, `platform`, with its own version table. The existing runner keeps `public`.** Where the platform needs a change in `public` (rare), it is made as a normal numbered SQL migration.
- **One identity for both services.** Both sign and verify tokens with the same `AUTH_SECRET`. A token issued by either is accepted by both; revoking a session must be honoured by both.
- **Background push on phones.** Without Google's FCM, an Android app that has been closed by the system cannot be woken by our server. Without Apple's APNs the same holds on iPhone. This is a platform rule, not something code can remove. Phase 6 documents exactly what is delivered in which state.
- **Nothing is hosted.** Web Push needs https and a public address to be tested end to end with a real browser subscription.
- **Mobile repository.** Pushes are refused until the Claude GitHub App is installed on `Everest-Sales-app-Mobile`.

## 5. Files that will change
- New: `backend/` (the Python service), `docs/platform/`, additions to `docker-compose.yml`, `.env.example`.
- Existing, small edits only: `lib/auth.ts` (accept platform tokens and honour revoked sessions), the login and password routes and `lib/crud.ts` (password hashing, role guard), `public/sw.js` and one small client helper (web push), admin screens under `app/(console)`.
- Mobile: `src/lib/api.ts`, `src/lib/session.tsx` (refresh tokens), a realtime client, notification registration.

## 6. Implementation plan
Phases 1 to 9 as in the brief. Each phase ends with its tests run and a report in `docs/platform/REPORT-phase-N.md`; progress is tracked in `docs/platform/CHECKLIST.md`.

## 7. Database migration and rollback plan
- Every platform table is created by Alembic in schema `platform`. `alembic downgrade` removes them; `drop schema platform cascade` removes everything the platform added, without touching business data.
- No existing table is dropped, renamed or rewritten. Additive columns in `public` go through the existing numbered migrations and are nullable or have defaults.
- Before the first deployment on real data: take a `pg_dump`, apply migrations, run the smoke suite against a restored copy.

## 8. Security risks found and what is planned

| Risk in the current system | Severity | Plan |
| --- | --- | --- |
| A stolen token works for 30 days and cannot be revoked singly | High | Phase 2: 15-minute access token, rotating refresh token, per-session revocation |
| Login rate limit is in memory, lost on restart, per process | Medium | Phase 2: counters in the database |
| bcrypt cost 10 | Low | Phase 2: Argon2id, upgraded at the next login |
| No record of failed logins by address or device | Medium | Phase 2: login history |
| An admin-level account could raise its own or another's role without limit | Medium | Phase 2: level guard on the server |
| Photos can only be read by id; ids are sequential | Low | Phase 5: files get random ids and owner checks |
| No backup has ever been taken or restored | High | Phase 9: scripts and a restore test |
| Docker files never run | Medium | Phase 9: they cannot be run where this was written; flagged again in the deployment guide |
