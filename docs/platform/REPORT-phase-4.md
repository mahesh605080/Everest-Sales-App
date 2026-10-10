# Phase 4 report — realtime engine and event recovery

**Status: complete and tested. Runs in one process; see section 8.**

1. **Features.**
   - **Event log** (`platform.events`). A row is written in the same database transaction as the change it describes. A trigger announces it with PostgreSQL `NOTIFY`, which is delivered only on commit, so a rolled-back change is never published. Because the log is a table, the web app publishes events by inserting a row; no message broker and no Redis are needed.
   - **Ordering.** A second trigger takes a transaction-long lock and numbers the row after it, so event ids are committed in order. This is what makes "give me everything after id N" exact.
   - **WebSocket endpoint** `/ws`. Authentication by the browser's cookie (own pages only) or by a first `auth` message with the access token; a new token can be sent on the open connection. Heartbeat every 25 s; connections silent for 75 s, with an expired token, or whose login was ended are closed.
   - **Channels and who may listen:** `user:<id>` (only that person, not even a manager), `all`, `role:<key>`, `area:<id>`, `region:<id>` (own territory, or level 4 and above), `data:<collection>` (collections marked realtime, readers only). Unknown names are refused.
   - **Recovery.** `subscribe` with `since` replays what was missed, then continues live, with live events held back until the replay is queued: each event arrives once and in order. `GET /api/v1/realtime/events` gives the same catch-up to a client that polls.
   - **Duplicate protection:** per-connection high-water mark per channel; optional `dedupe_key` stores an event once.
   - **Chat:** direct and group conversations, stored messages, idempotent sending (`client_id`), unread counts, history paging, delivery and read receipts, presence (who is online). A conversation you are not in answers 404.
   - **Web app:** live connection manager with reconnect, back-off and catch-up; the bell and a toast update the moment a notification, notice or chat message is made; a Chat screen.
   - **Mobile app:** the same connection manager using the access token, re-authenticating after a refresh; Chat screens; Today shows new notifications at once.
   - Document-store changes are published for collections marked `realtime`.
2. **Existing files modified.** Web: `lib/notify.ts` (every notification also becomes an event), `app/api/notices/route.ts`, `components/Shell.tsx`, `app/(console)/layout.tsx`, `next.config.mjs`, `lib/perm.ts`, `scripts/seed.ts`, `scripts/smoke.ts`. Backend: `app/main.py`, `app/services/documents.py`. Mobile: `src/app/_layout.tsx`, `(tabs)/index.tsx`, `(tabs)/more.tsx`, `src/lib/api.ts`.
3. **New files.** Backend: `app/models/realtime.py`, `app/services/events.py`, `app/services/chat.py`, `app/realtime/hub.py|socket.py|receipts.py`, `app/routers/realtime.py`, `migrations/versions/0004_*.py`, `tests/test_realtime.py`. Web: `lib/realtime.ts`, `components/Chat.tsx`, `app/(console)/chat/page.tsx`, `db/migrations/023_chat_permission.sql`. Mobile: `src/lib/realtime.ts`, `src/app/chat/index.tsx`, `src/app/chat/[id].tsx`.
4. **Migrations.** Platform `0004` (events with two triggers, chat_rooms, chat_members, chat_messages). Web `023` (permission `chat.use` for every role). Applied.
5. **Tests run.** Backend 59 passed (15 new, over real WebSocket connections). Web suite 179 passed (4 new). Two real browsers logged in as different people: chat arrived without reload, "Read" appeared for the sender, and an order approval produced a toast on the other person's dashboard. Mobile preview: live connection, message sent, reply arrived live. Mobile unit tests 12 passed.
6. **Existing versus new failures.** None.
7. **Security controls verified by test.** No token, bad token and a cookie from a foreign page are refused (close code 4401); private channels cannot be subscribed by anyone else including a General Manager; channel names are matched against fixed patterns; ending a login closes its socket; message size limit; chat membership enforced on REST and on the socket; a rolled-back event is not delivered.
8. **Limitations.**
   - Live connections are held in one process. Events themselves come from the database, so a second process would deliver them too, but **presence** and the **delivery receipt** are per process. Run one platform process; that is what the Docker file does. Redis is not needed at this size.
   - A connection that cannot keep up (500 queued messages) is closed and must reconnect and resume.
   - Old events are not yet pruned; the scheduled job for that is part of Phase 7.
   - On a phone the live connection exists only while the app is open. It is not a way to reach a closed app; that is the subject of Phase 6.
   - Publishing every event takes a short database-wide lock. At tens of events per second this is not noticeable; it would need redesign for thousands.
9. **Configuration.** For local development without a reverse proxy the web app passes `/ws` through to `PLATFORM_URL`. Optional `NEXT_PUBLIC_PLATFORM_WS` to point browsers elsewhere.
10. **Commands.** As before.
11. **Next.** Phase 5, file storage.
