# API reference

Generated from the service's route table by `backend/scripts/api_doc.py`. Do not edit by hand.
The same list, with request and response shapes and a try-it page, is served at `/api/v1/docs` when the service is not in production mode, and as OpenAPI JSON at `/api/v1/openapi.json`.

## Health

| Method | Path | What it does |
|---|---|---|
| GET | `/api/v1/health` | Is the process alive |
| GET | `/api/v1/health/ready` | Can it serve requests: database reachable and migrations applied |

## Login and sessions

| Method | Path | What it does |
|---|---|---|
| POST | `/api/v1/auth/login` | Log in; returns a short access token and a refresh token |
| POST | `/api/v1/auth/logout` | End this login only |
| POST | `/api/v1/auth/logout-all` | End every login of this person, on every device |
| GET | `/api/v1/auth/me` | The person behind the token, with role and permissions |
| POST | `/api/v1/auth/password` | Change own password; every other device is logged out |
| POST | `/api/v1/auth/password/reset/confirm` | Set a new password with a reset link or code |
| POST | `/api/v1/auth/password/reset/request` | Ask for a reset link by email (same answer whether or not the account exists) |
| POST | `/api/v1/auth/refresh` | Exchange a refresh token for a new access token and a new refresh token |
| GET | `/api/v1/auth/sessions` | Where this person is logged in |
| DELETE | `/api/v1/auth/sessions/{session_id}` | End one of this person's other logins |

## People administration

| Method | Path | What it does |
|---|---|---|
| GET | `/api/v1/admin/login-events` | Security history: logins, refusals, resets, forced logouts |
| POST | `/api/v1/admin/users/{user_id}/activate` | Let a suspended account be used again |
| POST | `/api/v1/admin/users/{user_id}/logout-all` | Sign the person out everywhere |
| POST | `/api/v1/admin/users/{user_id}/reset-code` | A one-time code the person uses to set a new password. Shown once; pass it on by phone. |
| GET | `/api/v1/admin/users/{user_id}/sessions` | Where one person is logged in |
| POST | `/api/v1/admin/users/{user_id}/suspend` | Stop the account from being used; nothing is deleted |

## Document store

| Method | Path | What it does |
|---|---|---|
| PUT | `/api/v1/admin/collections` | Create a collection or change its rules and fields (Super Admin) |
| DELETE | `/api/v1/admin/collections/{name}` | Switch a collection off. Its documents are kept, not erased. |
| GET | `/api/v1/data` | The collections that exist |
| GET | `/api/v1/data/{collection}` | List documents. Filter with f.<field>=, f.<field>.gte=, .lte=, .gt=, .lt=, .in=a,b |
| POST | `/api/v1/data/{collection}` | Create a document. Fields are checked against the collection's declared fields. |
| GET | `/api/v1/data/{collection}/{doc_id}` | One document |
| PATCH | `/api/v1/data/{collection}/{doc_id}` | Change some fields. Send if_version to refuse the change if somebody else saved first. |
| DELETE | `/api/v1/data/{collection}/{doc_id}` | Delete a document |

## Live updates and chat

| Method | Path | What it does |
|---|---|---|
| GET | `/api/v1/admin/realtime` | Live connection figures |
| GET | `/api/v1/chat/people` | Colleagues who can be written to: name and role only |
| GET | `/api/v1/chat/rooms` | This person's conversations with unread counts and the last message |
| POST | `/api/v1/chat/rooms` | Open a conversation. With one other person and no name, the existing direct conversation is returned. |
| GET | `/api/v1/chat/rooms/{room_id}/messages` | A page of messages, newest last. Fetching them marks them delivered. |
| POST | `/api/v1/chat/rooms/{room_id}/messages` | Send a message. A repeated client_id returns the message already stored. |
| POST | `/api/v1/chat/rooms/{room_id}/read` | Mark a conversation read up to a message |
| GET | `/api/v1/realtime/events` | Events of a channel after a given id: the same catch-up a reconnecting socket gets, for clients that poll |
| GET | `/api/v1/realtime/presence` | Which of the given people have a live connection now |
| POST | `/api/v1/realtime/publish` | Send an event to a channel (Super Admin). Announcements go to the channel 'all'. |

## Files

| Method | Path | What it does |
|---|---|---|
| PUT | `/api/v1/admin/files/quota/{user_id}` | Give one person a different storage allowance |
| GET | `/api/v1/admin/files/usage` | Storage used: in total, by type and per person |
| POST | `/api/v1/files` | Upload one file (multipart form field 'file'). Private to the uploader until shared. |
| GET | `/api/v1/files` | scope = mine (default) \| shared \| all (needs files.manage) |
| GET | `/api/v1/files/signed/{token}` | Download through a time-limited link. No login needed; the link is the permission. |
| GET | `/api/v1/files/{file_id}` | A file's details (not its contents) |
| PATCH | `/api/v1/files/{file_id}` | Rename or move to another folder (owner only) |
| DELETE | `/api/v1/files/{file_id}` | Delete a file (owner or files.manage). Recoverable by an operator for seven days. |
| GET | `/api/v1/files/{file_id}/download` | The file's contents. inline=true shows images and PDF in the browser. |
| GET | `/api/v1/files/{file_id}/history` | Who uploaded, downloaded, shared or deleted the file |
| POST | `/api/v1/files/{file_id}/link` | A download link that works without login until it expires |
| PUT | `/api/v1/files/{file_id}/shares` | Set who else may open the file. The list replaces the previous one; an empty list makes it private again. |

## Notifications and push

| Method | Path | What it does |
|---|---|---|
| GET | `/api/v1/admin/notify/queue` | How the queue stands: counts by state, devices registered, how long the oldest due item has waited |
| GET | `/api/v1/admin/notify/users/{user_id}/preferences` | One person's notification settings |
| PUT | `/api/v1/admin/notify/users/{user_id}/preferences` | Change one person's notification settings |
| GET | `/api/v1/admin/push/subscriptions` | Every registered device, without keys or full addresses |
| POST | `/api/v1/admin/push/subscriptions/{sub_id}/disable` | Stop push to one device |
| POST | `/api/v1/notifications` | Send now or schedule. Send an Idempotency-Key header so a repeated request does not send twice. |
| GET | `/api/v1/notifications` | History of what was sent, newest first. Senders see their own; managers see everything, and the system's with source=system or all. |
| POST | `/api/v1/notifications/ack` | Called by the device when it has shown a push, and again when it is tapped. The token inside the push is the permission. |
| GET | `/api/v1/notifications/preferences` | This person's notification settings |
| PUT | `/api/v1/notifications/preferences` | Set push on or off, muted kinds and quiet hours |
| GET | `/api/v1/notifications/{note_id}` | One notification with every delivery attempt and its result |
| POST | `/api/v1/notifications/{note_id}/cancel` | Cancel a scheduled notification, or withdraw the push not yet sent |
| POST | `/api/v1/notifications/{note_id}/retry` | Queue again the push deliveries that failed, gave up or expired |
| GET | `/api/v1/push/config` | What the app needs to register for push: the public key and which channels are switched on |
| GET | `/api/v1/push/subscriptions` | The devices this person has registered for push |
| POST | `/api/v1/push/subscriptions` | Register this browser or phone for push. Called after the person has allowed notifications. |
| POST | `/api/v1/push/unsubscribe` | Stop push to this browser or phone (call at logout) |

## Operations (Super Admin)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/v1/admin/alerts` | Open alerts (or all, with open_only=false) and the list of health rules |
| POST | `/api/v1/admin/alerts/{alert_id}/acknowledge` | Mark an alert as seen. It still closes only when the problem is gone. |
| GET | `/api/v1/admin/jobs` | Recent jobs, newest first, with counts by state |
| POST | `/api/v1/admin/jobs` | Run one of the built-in jobs now |
| GET | `/api/v1/admin/jobs/kinds` | The kinds of job that exist, and the numbers each accepts |
| GET | `/api/v1/admin/jobs/{job_id}` | One job with its result or error |
| POST | `/api/v1/admin/jobs/{job_id}/cancel` | Stop a job that has not started. One that is running finishes. |
| POST | `/api/v1/admin/jobs/{job_id}/retry` | Queue a job that failed for good, with its tries reset |
| GET | `/api/v1/admin/monitor` | One page of how the service is doing |
| GET | `/api/v1/admin/schedules` | Every schedule with its next and last run |
| PATCH | `/api/v1/admin/schedules/{name}` | Switch a schedule on or off, or change how often it runs. The kind of work cannot be changed. |
| POST | `/api/v1/admin/schedules/{name}/run` | Run a schedule's job now, without waiting for its time |
| GET | `/api/v1/admin/sessions` | Who is logged in right now, on what, newest activity first |
| DELETE | `/api/v1/admin/sessions/{session_id}` | End one login now. The person must log in again on that device. |

## Database view (Super Admin)

| Method | Path | What it does |
|---|---|---|
| GET | `/api/v1/admin/db/indexes` | Every index with how often it has been used; an index never used is a candidate for removal |
| GET | `/api/v1/admin/db/overview` | Database size, connections, migration state and every table with its size |
| GET | `/api/v1/admin/db/tables/{schema}/{table}` | Columns and a page of records, newest first. Secret columns are masked. |

## Live connection

| | Path | |
|---|---|---|
| WebSocket | `/ws` | See `INTEGRATION.md` for the messages. |
