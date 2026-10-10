# Integration guide

How an app talks to the platform service. Every example is plain `fetch`; the web app and the mobile app in this project do exactly this (`lib/realtime.ts`, `lib/files.ts`, `lib/push.ts` in the web app; `src/lib/api.ts`, `realtime.ts`, `notify.ts` in the mobile app).

## Conventions

- Base path `/api/v1`. JSON in, JSON out. Times are ISO 8601 in UTC.
- **Errors** always look the same: `{"error": "A sentence a person can read.", "code": "forbidden", "request_id": "…"}`, sometimes with `"fields": {"name": "what is wrong"}`. Show `error` to the user; branch on `code` or the HTTP status. Quote `request_id` when reporting a problem: the server log has the same id.
- Status codes: `401` not logged in or login ended, `403` not allowed, `404` not there (also used for "exists but not yours"), `409` conflict, `413` too large, `415` file type refused, `422` wrong input, `429` slow down.
- Every response carries `X-Request-Id`.
- Lists take `limit` and `offset` (or `before`/`before_id` for histories).

## Logging in

A phone or other non-browser client:

```js
const r = await fetch(base + '/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ login: 'SO01', password, device: { installation_id: 'app-…8+ chars…', platform: 'android', model: 'Pixel 8' } }) });
const { access_token, refresh_token, expires_in, user } = await r.json();   // expires_in: seconds, 900 by default
```

- Send `Authorization: Bearer <access_token>` on every call, to both services.
- The access token lasts minutes. On a `401`, call refresh once and repeat the request:

```js
const r = await fetch(base + '/api/v1/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refresh_token }) });
// 200: store BOTH new tokens. 401: the login is over; send the person to the login screen.
```

- **A refresh token works once.** Each refresh returns a new one. If the answer is lost and the same token is sent again within 30 seconds, it is accepted once more and a fresh pair is returned. A token replayed later than that is treated as stolen and the whole login is ended. So: never run two refreshes at once, and store the new pair before using it.
- Keep tokens in the platform keystore (Keychain, Android Keystore), never in ordinary storage.
- `user.must_change_password: true` means only `POST /auth/password` will work until it is changed.
- A browser on the same site does not handle tokens at all: the web app's login sets an http-only cookie, and both services accept it. Requests that change something must come from the site's own origin.

Other calls: `GET /auth/me`, `GET /auth/sessions` (where am I logged in), `DELETE /auth/sessions/{id}`, `POST /auth/logout`, `POST /auth/logout-all`, `POST /auth/password`, and the reset pair `POST /auth/password/reset/request` and `/confirm`.

## Live connection

One WebSocket per app, at `/ws`. Messages are small JSON objects with a `type`.

```js
const ws = new WebSocket(base.replace(/^http/, 'ws') + '/ws');
ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: access_token }));   // a same-site browser page may skip the token: the cookie is used
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.type === 'ready') { /* m.user_id, m.channels (already subscribed), m.last_event_id */ }
  if (m.type === 'event') { /* m.id, m.channel, m.event, m.payload, m.at */ }
};
```

| You send | Meaning |
|---|---|
| `{type:'auth', token}` | Must be first, within 10 seconds |
| `{type:'subscribe', channel, since?}` | Listen to a channel. With `since` (an event id) the server first replays what you missed |
| `{type:'unsubscribe', channel}` | |
| `{type:'ping'}` | Send every 25 seconds or so; answered with `pong` |
| `{type:'chat.send', room, text, client_id, ref?}` | Send a chat message |
| `{type:'chat.read', room, upto?}` | Mark read |
| `{type:'presence', users:[ids]}` | Who is online |

| You receive | Meaning |
|---|---|
| `ready` | Authenticated. Your own channels are subscribed for you |
| `subscribed {channel, last_id}` | |
| `event {id, channel, event, payload, at}` | Something happened |
| `error {code, message, ref?}` | A request of yours was refused |

**Channels.** `user:<your id>` and `all` are subscribed for you. Others, each checked on the server: `role:<key>` (your own role), `area:<id>`, `region:<id>` (yours, or anything for level 4 and above), `data:<collection>` (collections marked live that you may read in full). Anything else is refused.

**Events you will see:** `notification` (new inbox row: title, body, link), `notice`, `chat.message`, `chat.receipt`, and for the document store `document.created`, `document.updated`, `document.deleted` (on `data:<collection>` and on the owner's own channel).

**Not missing anything.** Event ids only ever go up, in the order the changes were saved. Remember the highest id you have seen per channel. After a reconnect, subscribe again with `since: <that id>`; ignore any event whose id is not higher than what you have. If you were away longer than events are kept (14 days), reload the data instead.

**Closing codes.** `4401`: the token ran out or the login ended; refresh and reconnect, or go to login. `1013`: you were too slow to keep up; reconnect with `since`. Reconnect with a growing pause (1 s, 2 s, 4 s ... 30 s) and a little randomness.

**When the app is closed** this connection is gone. It is not a way to wake a closed app; see `NOTIFICATIONS.md`.

Clients that cannot hold a socket can poll `GET /realtime/events?channel=…&since=…`.

## Chat

`GET /chat/people?q=` → who can be written to. `POST /chat/rooms {user_ids:[…], name?}` → opens (or returns) a conversation. `GET /chat/rooms` → list with unread counts. `GET /chat/rooms/{id}/messages?before=&limit=` → history. `POST /chat/rooms/{id}/messages {text, client_id}` → send. `POST /chat/rooms/{id}/read`.

Always send a `client_id` you made up (a UUID) with a message. If the connection drops and you send it again, the server returns the message it already stored instead of making a second one.

## Files

```js
const fd = new FormData(); fd.append('file', file); fd.append('folder', 'Collections/October'); fd.append('ref_type', 'collection'); fd.append('ref_id', '42');
const f = await (await fetch(base + '/api/v1/files', { method: 'POST', headers: { authorization }, body: fd })).json();   // do not set content-type yourself
```

- A file is private to the uploader until shared: `PUT /files/{id}/shares {user_ids, role_key, everyone}` (the list replaces the previous one).
- Accepted: JPG, PNG, WEBP, GIF, PDF, XLSX, DOCX, PPTX, CSV, TXT. The server looks at the content, not the name; a mismatch is refused with `415`.
- Download: `GET /files/{id}/download` with the token. To hand a file to someone without a login: `POST /files/{id}/link {seconds}` → a path that works until it expires.
- `GET /files?scope=mine|shared|all&ref_type=&ref_id=&q=` lists, and returns the caller's allowance (`quota`).

## Document store

For small app data that does not deserve its own table (drafts, preferences, checklists). A Super Admin declares a collection with its fields and rules; apps then read and write documents.

```js
await fetch(base + '/api/v1/data/visit_notes', { method: 'POST', headers, body: JSON.stringify({ customer_id: 12, note: 'Asked for rate letter' }) });
await fetch(base + '/api/v1/data/visit_notes?f.customer_id=12&limit=20', { headers });
await fetch(base + `/api/v1/data/visit_notes/${id}?if_version=3`, { method: 'PATCH', headers, body: JSON.stringify({ note: 'Sent' }) });   // 409 if someone saved first
```

Field types: string, text, integer, number, boolean, date, datetime, enum, json. Rules: `owner` (only who made it), `authenticated` (anyone logged in, reading only), or a permission name such as `sales.view`. Unknown fields and wrong types are refused. Filters: `f.<field>=`, `.gte=`, `.lte=`, `.gt=`, `.lt=`, `.in=a,b`.

Business records (customers, orders, collections ...) are **not** here; they stay in the web app's API under `/api/*`.

## Push registration

Browser (the full version is `lib/push.ts`):

```js
const cfg = await (await fetch('/api/v1/push/config')).json();            // { webpush: { enabled, public_key }, apns: { enabled }, categories }
if (cfg.webpush.enabled && (await Notification.requestPermission()) === 'granted') {   // must run inside a click handler
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToBytes(cfg.webpush.public_key) });
  const j = sub.toJSON();
  await fetch('/api/v1/push/subscriptions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'webpush', endpoint: j.endpoint, keys: j.keys }) });
}
```

iPhone app: get the native APNs token and post `{channel: 'apns', endpoint: <token>, installation_id, app_version}`.

At logout call `POST /push/unsubscribe {endpoint}`. On every start, post the subscription again: it is cheap, and it moves the device to whoever is logged in now.

**The push message** your service worker or app receives is JSON: `{id, title, body, url, icon, category, ack}`. Show it, then report back so the server can say "shown on device":

```js
await fetch('/api/v1/notifications/ack', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: msg.ack, clicked: false }) });   // again with clicked: true on tap
```

Treat `url` as untrusted: open it only if it is a path inside your app.

## Sending notifications from code

```js
await fetch(base + '/api/v1/notifications', { method: 'POST', headers: { ...headers, 'idempotency-key': crypto.randomUUID() },
  body: JSON.stringify({ title: 'Depot closed tomorrow', body: '…', category: 'announcements', url: '/notices',
    audience: { kind: 'role', key: 'so' },          // or {kind:'users', ids:[…]}, {kind:'area', id}, {kind:'region', id}, {kind:'all'}
    priority: 5,                                    // 1 = urgent: passes quiet hours
    scheduled_at: null }) });
```

Needs the permission `notify.send`; anything wider than named people also needs `notify.broadcast`. Reuse the same `idempotency-key` when retrying a request whose answer was lost.

Code inside the web app does not call this: it uses `notify()` in `lib/notify.ts`, which writes the inbox row; the platform picks it up and adds push by itself.
