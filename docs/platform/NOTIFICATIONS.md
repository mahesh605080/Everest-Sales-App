# Notifications: what reaches whom, and when

This is the honest picture. "Tested here" means it was run in this project's test environment; "not tested" means the code exists but has never run on that kind of device.

## How a notification travels

1. Something makes a notification: the web app itself (order approved, booklet waiting, claim decided ...), a chat message to someone who is away, or a person with the *Send notifications* permission.
2. It is written to the person's **inbox** (the bell). This always happens and needs nothing else.
3. If the app or site is open, it shows **at once** over the live connection.
4. For each device the person has registered, a **push** is queued. The queue retries with growing pauses, respects quiet hours and muted kinds, and gives up after a set number of tries.

## Words used for the result

| Word on screen | What it really means |
|---|---|
| In the inbox | Written to the bell. Certain. |
| Waiting to send | Queued; not yet handed to anyone. |
| Accepted by push service | The browser vendor's or Apple's server took the message. **This is not proof the device showed it.** |
| Shown on device | The device itself reported back that it displayed the notification. Only then do we say this. |
| Will retry | A temporary failure; another attempt is scheduled. |
| Could not be sent | Gave up, or the device registration is no longer valid. The reason is recorded. |
| Expired unsent | Its time ran out before it could be sent. |
| Held back | The person muted this kind, or got too many in the last hour. |

## Capability matrix

| Where | App or page open | In the background | Closed | Tested here |
|---|---|---|---|---|
| **Web, Chrome / Edge / Firefox on a computer** | At once (live connection) | Push, normally within seconds | Push, as long as the browser itself is running in the background. If the browser is fully shut, it arrives when the browser next starts | Encryption, signing, queue and the service worker's display and report-back were run in a real Chromium. A real push service was **not** reachable from the test machine, so the last hop (vendor's server to browser) is not tested |
| **Web, Chrome on Android** | At once | Push | Push (Android wakes Chrome) | Not tested on a phone |
| **Web, Safari on iPhone / iPad** | At once | Push, only after the site is added to the Home Screen (iOS 16.4 or newer) | Same | Not tested |
| **Android app** | At once (live connection, shown as a phone notification) | While *On duty* is recording the route: within about two minutes. Otherwise when Android lets the periodic check run | The periodic check, about every 15 minutes at best; later in battery saver or Doze; **never after "Force stop"**, and some phone makers stop it for apps not opened for days | Decision rules unit-tested. **Never run on a real phone** |
| **iPhone app, with Apple credentials on the server** | At once | Push straight from Apple (APNs), normally within seconds | Push from Apple | The sender is tested against a stand-in for Apple's server (address, headers, signed token, dead-token handling). **Never sent to Apple or a real iPhone**: needs an Apple Developer account and a signed build |
| **iPhone app, without Apple credentials** | At once | When iOS lets the periodic check run; iOS decides, often much less than every 15 minutes | Same; not after the app is swiped away on some iOS versions | Not tested |

### Why the Android app cannot be woken instantly when closed

Android offers one system-wide way to wake a closed app with a message: Google's Firebase Cloud Messaging. This project does not use Firebase. Without it, a closed app can only look for news when the system lets it run. That is a platform limit, not something more code can remove. The practical answer for field staff is the *On duty* switch: while it is on, Android keeps the app alive for the route recording and notifications arrive within a couple of minutes.

If instant delivery to closed Android apps becomes necessary, the choices are: (a) allow FCM as a transport only (the content can still be encrypted by our server), or (b) keep a permanent foreground connection with a constant notification in the status bar, at a battery cost. Neither is built.

### Two things worth knowing about "no third party"

- **Web Push always goes through the browser maker's push service** (Google for Chrome, Mozilla for Firefox, Apple for Safari, Microsoft for Edge). That is how the web standard works; there is no other way to reach a closed browser. No Firebase SDK, account or project is used: the server speaks the open Web Push protocol directly, signs with its own key pair (VAPID), and encrypts every message so the push service cannot read it. This was verified by decrypting what the server sent with the receiving browser's key, and by showing that another key cannot.
- **The Android app uses the library `expo-notifications` to show notifications on the phone.** That library's Android part is compiled together with Google's messaging client. It is never started: there is no Firebase project, no `google-services.json`, and the app never asks for a Google push token. Nothing travels through Google for the Android app. If even an unused copy of that code is unwanted, the library has to be replaced with one that only shows local notifications; that is a contained change in `src/lib/notify.ts`.

## What the server will and will not do

- It posts only to known browser push services (`PUSH_ENDPOINT_HOSTS`) and to Apple. A made-up subscription cannot make it call another address.
- A device registration belongs to the login it was made under. Log out, a password change, an administrator ending the session, or expiry stops push to that device, also for messages already queued.
- A shared browser follows whoever is logged in now.
- A push carries the title, text, an in-app path and a one-time report-back token. Nothing else. A tap can only open a page of this site or app.
- People choose: push on or off, kinds to mute, quiet hours (Nepal time). Urgent messages pass quiet hours and the hourly limit; they do not pass a mute.
- At most `NOTIFY_MAX_PER_USER_PER_HOUR` (30) notifications per person per hour; more are held back and reported as such.

## Setting it up

**Browser push**

```
cd backend && python -m app.cli vapid
```

Put the three lines it prints into the server's `.env` (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` with a real mail address). Restart the platform service. People then switch it on under *My account → Notifications*. Changing the keys later makes every browser subscribe again on its next visit.

**iPhone push** (needs an Apple Developer account)

In the Apple Developer site create a key with *Apple Push Notifications service* enabled and download the `.p8` file. Set `APNS_KEY` (the file's contents, line breaks written as `\n`), `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_TOPIC` (the app's bundle id, `com.everestparenterals.sales`) and `APNS_SANDBOX=true` for development builds. The app registers its token by itself at login.

**Without either**, everything still works through the inbox and the live connection; the admin screen says which channels are off.
