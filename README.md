# Everest Sales (mobile app)

The Android and iOS app for the field team of Everest Parenterals Pvt. Ltd. It is a native app written in React Native (Expo), not the website inside a wrapper. It talks to the same server as the web app ([Everest-Sales-App](https://github.com/mahesh605080/Everest-Sales-App)) through its JSON API.

## What is in it now

| Screen | What it does |
| --- | --- |
| Login | Server address (asked once), employee code or mobile number, password. The session is kept in the phone's encrypted keystore. A temporary password must be changed first |
| Today | The day's figures (chances to sell, stock that will not sell in time, approvals waiting) and the ranked action list with Done / Later / Not interested |
| Customers | Own customers, nearest first, with search. Planned visits on top |
| Customer | Check in with GPS, credit, class, returns allowance, rebate, own rates, running schemes, stock at the customer, recent orders and visits |
| Visit | Check out with purpose, person met and remarks; take an order, collection or stock report from inside the visit |
| New order | Every product with plus/minus; rate, scheme, free boxes and "2 more for 1 more free" as you type; repeat last order; suggested order from the customer's stock; overstock warning; near-expiry lot orders; booklet orders |
| Orders | Mine, to approve, to dispatch, team; order detail with batches to send; approve, reject, dispatch, withdraw |
| Approvals | Everything waiting for the person, with Approve and Reject in place |
| Collection, Stock report, Near-expiry offers, Notifications | The field entries and lists |
| More | "On duty" switch that records the day's route in the background, waiting-to-send list, change password, log out |

### Works without a connection
- Lists already seen are kept on the phone and shown, marked "No connection", when the server cannot be reached.
- An order, a collection or a stock report written without a connection is saved on the phone ("Waiting to send") and sent by itself when the phone is online again. Each carries its own reference, so the server never books it twice.
- If the server refuses a waiting item (for example the batch has been sold), it stays in the list with the reason, to try again or delete.
- Check-in and check-out need a connection, because the server confirms the distance to the customer at that moment.

### Location
- Check-in sends the GPS position; Android's "mock location" flag is sent with it and the manager gets an alert.
- "On duty" records the route every two minutes or 100 m, also with the app closed, and uploads it in batches. Android shows a permanent notification while it runs.

### Notifications on the phone

- New notifications and chat messages show as phone notifications. A tap opens the right screen.
- **While the app is open** they arrive at once. **While "On duty" is on** they arrive within about two minutes, also with the phone in the pocket. **With the app closed and duty off**, Android lets the app check about every 15 minutes at best, later in battery saver, and not at all after "Force stop". A closed Android app cannot be woken instantly without Google's messaging service, which this app does not use.
- On an iPhone, once the server has Apple credentials, notifications come straight from Apple and arrive with the app closed.
- More → Notification settings: allow notifications, switch kinds off, set quiet hours. Whatever is switched off still appears in the Notifications list.
- The library that shows notifications on Android is compiled together with Google's messaging client. It is never started: there is no Firebase project or configuration in this app, and nothing travels through Google.
- None of this has run on a real phone yet. The rules that decide what is new and where a tap leads are unit-tested.

The full picture for every kind of device is in the web repository, `docs/platform/NOTIFICATIONS.md`.

## Not built yet
Selfie or photo capture, the tour plan, booklet creation, claims, samples and competitor entries, the manager's live map, Nepali (BS) dates, and a Nepali-language screen option. These are on the web app today.

## How it was checked
- `npm run typecheck` and `npm test` (24 unit tests for the offline queue, the price rules and the notification rules) pass.
- The app was run in a browser preview at phone size against the real server with demo data: login, check-in, order with scheme, order with no connection and its later sending, check-out, collection, stock report, offers and approvals.
- The Android project generates (`expo prebuild`) with the right permissions and the Android JavaScript bundle builds.
- **It has not yet been installed on a real phone or emulator**: no Android SDK was available where it was written. GPS, background route recording, the keystore and the look on a real device are therefore unproven until the first APK is tried.

## Get the APK without Android Studio
Push to `main` (or open the **Actions** tab and run "Android test APK"). After about 15 to 25 minutes the run has an artifact `everest-sales-apk`: download, unzip, copy the `.apk` to the phone and install it. This workflow has not been run yet; the first run will show whether it needs adjusting.

The app needs the server address at login. The server must be reachable from the phone: a hosted `https://` address, or for a first test a computer on the same Wi-Fi (`http://192.168.x.x:3000`).

## For a developer
```bash
npm install
npx expo start            # scan the QR code with a development build
npm run typecheck && npm test
npx expo run:android      # needs Android Studio and an emulator or phone
```
The app uses native modules (secure storage, background location), so it needs a development build or the APK; Expo Go is not enough for the route recording.

| Path | What it is |
| --- | --- |
| `src/app/` | Screens (Expo Router: one file per screen) |
| `src/lib/api.ts`, `session.tsx` | Server calls, login session |
| `src/lib/data.ts` | Cached reads that fall back to the phone's copy |
| `src/lib/outbox*.ts` | The waiting-to-send queue |
| `src/lib/pricing.ts` | The server's price and scheme rules, mirrored for the order screen |
| `src/lib/location.ts` | GPS fix, mock flag, background route |
| `src/ui/` | Shared components |
| `src/theme.ts` | Colours and type |

iOS: the same code builds for iPhone, but that needs a Mac or Expo's cloud build and an Apple developer account; it has not been attempted.
