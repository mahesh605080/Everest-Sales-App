# Phase 6 report — notification engine, web push, Android and iOS

**Status: built and tested as far as this environment allows. The last hop to a real device is not tested; see item 8.**

1. **Features.**
   - **Engine.** One notification fans out into a delivery per person and channel (`inapp`, `webpush`, `apns`). Audience: named people, a role, an area, a region, everyone. Send now or at a set time; cancel; idempotency key so a repeated request sends once.
   - **States that say what happened**: queued, processing, accepted (push service took it), confirmed (the device reported it showed it), stored (inbox), skipped, expired, failed (will retry), dead. "Accepted" is never shown as delivered.
   - **Queue.** Rows are claimed with row locks, so several workers never send the same one. Retries with exponential pauses and jitter (30 s, 1 min, 2 min ... capped at an hour), the push service's `Retry-After` respected, give up after `NOTIFY_MAX_ATTEMPTS`. A registration the push service calls gone is switched off. Work left "processing" by a crash returns to the queue after five minutes. A sender that throws does not stop the rest.
   - **Web Push** by the open standard: VAPID-signed, payload encrypted for the one browser (aes128gcm). No Firebase SDK, account or project.
   - **APNs** sender, direct to Apple over HTTP/2 with an ES256 provider token that is reused as Apple requires.
   - **Device registry.** A registration is tied to the login it was made under; when that login ends push stops, also for messages already queued. A shared browser follows whoever is logged in.
   - **Preferences** per person: push on/off, muted kinds, quiet hours in Nepal time. Urgent passes quiet hours and the hourly limit. Limit of 30 per person per hour.
   - **The web app's own notifications** (approvals, decisions ...) are picked up from the inbox table by a cursor and get push too, with no second inbox row and no change to the web app's code paths. **Chat messages** push to members who have no live connection.
   - **Worker** inside the service: releases scheduled sends, picks up inbox rows, sends, recovers stuck work, every 2 seconds.
   - **Web app.** Service worker shows pushes, reports back "shown" and "opened", and opens only pages of this site. *My account → Notifications*: switch on for this browser, mute kinds, quiet hours. *Send notification* screen: compose, audience, schedule, urgent, history with per-person results, withdraw, retry.
   - **Mobile app.** Phone notifications for new inbox rows and chat, shown at once while open, checked from the route-recording task while on duty, and from a periodic background task otherwise; tap opens the right screen; iPhone registers its Apple token when the server has Apple credentials; settings screen. Background jobs now load the saved login first (this also fixes route points not being sent when the app had been closed).
2. **Existing files modified.** Backend `app/config.py`, `app/main.py`, `app/models/__init__.py`, `app/services/chat.py`, `requirements.txt`, `scripts/test.sh`, `tests/test_foundation.py`. Web `public/sw.js`, `components/Shell.tsx`, `app/(console)/layout.tsx`, `app/(console)/profile/page.tsx`, `app/globals.css`, `lib/perm.ts`, `scripts/seed.ts`, `scripts/smoke.ts`, `.env.example`, `docker-compose.yml`. Mobile `app.json`, `package.json`, `src/lib/api.ts`, `src/lib/location.ts`, `src/lib/session.tsx`, `src/app/_layout.tsx`, `src/app/(tabs)/more.tsx`.
3. **New files.** Backend `app/models/notify.py`, `app/services/notify.py`, `app/services/push_senders.py`, `app/routers/notify.py`, `app/worker.py`, `app/cli.py`, `migrations/versions/0006_notification_engine.py`, `tests/test_notify.py`. Web `lib/push.ts`, `components/NotifySettings.tsx`, `components/NotifySend.tsx`, `app/(console)/notify/page.tsx`, `db/migrations/025_notifications_engine.sql`. Mobile `src/lib/notify.ts`, `src/lib/notify-core.ts`, `src/app/notify-settings.tsx`, `src/lib/__tests__/notify.test.ts`. Docs `NOTIFICATIONS.md`.
4. **Migrations.** Platform `0006` (notifications, deliveries, push_subscriptions, notify_prefs); checked with `alembic check`, rolled back and reapplied. Web `025` (column `notifications.origin`; permissions `notify.send`, `notify.broadcast` for GM and Super Admin, `notify.manage` for Super Admin). Both additive.
5. **Tests run.**
   - Backend: **104 passed** (35 new).
   - Web suite: **192 passed** (8 new), against the built app and the running platform service.
   - Mobile: **24 passed** (12 new); type check clean; web export builds.
   - In a real Chromium: the service worker was handed a push message through the browser's developer protocol; it displayed the notification, the server's delivery row moved to "confirmed", and a payload with an outside link and icon was reduced to in-site ones. Send screen and settings exercised; a notification sent by the GM appeared live on the officer's open page.
   - With the stack running, the worker picked up 47 notifications made by the web app during the suite, with no failed passes.
6. **Existing versus new failures.** None.
7. **Security controls verified by test.** Permission to send, and the stronger one to broadcast; queue and device administration only for `notify.manage`; endpoint allowlist (other hosts, plain http, look-alike host, internal and metadata addresses refused at registration, and never called even if written straight into the table); links and icons must be in-site paths; keys and full endpoint never returned by any API; the public key endpoint never includes the private key; report-back token is bound to one delivery and rejects tampering; garbage keys from a client cannot break the worker; a sender crash is not written into the record shown to users; push stops when the login ends or the password changes; a shared browser does not show the previous person's messages; payload contains only the six intended fields; encrypted body does not contain the text and cannot be opened with another key; VAPID token verifies with the public key and names the push service as audience.
8. **Limitations. Read these.**
   - **No message has gone through a real push service or Apple.** The test machine cannot reach them. What is proven is everything up to the request leaving the server (correct address, headers, signature, encryption) and everything after the browser receives it.
   - **The mobile app has never run on a phone.** Phone notifications, the background check, the tap handling and the Apple token registration are written against the libraries' documented behaviour and are type-checked; only the decision rules are unit-tested.
   - **A closed Android app cannot be woken instantly** without Google's messaging service. See the matrix in `NOTIFICATIONS.md`.
   - The Android notification library is compiled with Google's messaging client, unused. Explained in `NOTIFICATIONS.md`.
   - iPhone: "shown on device" cannot be confirmed (that needs a notification service extension); only "opened" is reported.
   - Browser push must be switched on by each person in each browser; a browser asks permission only on a click.
   - The worker runs inside the single service process. More than one process is safe for the queue (row locks) but the live connection is still single-process (Phase 4).
   - Old notification and delivery rows are not pruned yet (Phase 7).
   - No SMS or email channel.
9. **Configuration.** `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; `APNS_KEY`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC`, `APNS_SANDBOX`; `NOTIFY_MAX_ATTEMPTS`, `NOTIFY_MAX_PER_USER_PER_HOUR`, `NOTIFY_BATCH`, `PUSH_ENDPOINT_HOSTS`, `PLATFORM_WORKER`. All in `.env.example`; the compose file passes them through. Without the keys the channels report themselves off.
10. **Commands.** `cd backend && python -m app.cli vapid` makes the browser-push key pair. Tests as before.
11. **Next.** Phase 7: background jobs, scheduler, monitoring.
