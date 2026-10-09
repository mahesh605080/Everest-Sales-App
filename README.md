# Everest SFA — Phases 1 to 5 (web)

Sales force monitoring and control system for Everest Parenterals Pvt. Ltd.
This is Phase 1: the foundation that every later phase builds on.

## What Phase 1 contains

| Area | What works now |
| --- | --- |
| Login | Employee code or mobile number + password, hashed passwords, lock for 15 minutes after 5 wrong attempts, forced change of the temporary password |
| Roles | Admin, General Manager, Credit Control, RSM, ASM, Sales Officer. Permissions are data: Admin ticks boxes on the Roles page |
| Territory rule | A Sales Officer sees only assigned customers, an ASM the area, an RSM the region. Enforced on the server |
| Masters | Employees, regions, areas, product categories, products, payment terms, customers. Add, edit, deactivate (nothing is deleted), search |
| Customer assignment | One sales officer per customer; changing it keeps the old assignment with dates |
| Excel | Import (.xlsx or .csv) with a row-by-row error report, export, downloadable template for every master |
| Map | Customers on a map, plus the last known position of anyone sharing location |
| Location sharing | A field user opens "Share my location" on the phone browser; the control room sees it on the map within 20 seconds |
| Audit log | Every login, lock-out and data change with who, when, old value, new value and IP address |
| Settings | Geo-fence radius, approval bands, reminder hours and other limits used by later phases |

## What Phase 2 adds so far

| Area | What works now |
| --- | --- |
| My day | A field user starts the day with a sales projection, checks in and out at assigned customers, and ends the day with actual sales. Time and GPS are saved at each step |
| Geo-fence | A visit started farther from the customer than the radius in Settings is saved and flagged. A customer without a location gets it from the first visit |
| Visit rules | One open visit at a time, purpose and remarks (10+ characters) needed to close it, only assigned customers |
| Team today | Managers see who is on duty, late, on a visit, idle, visits and flagged visits, for today or any past date, limited to their area or region |
| Visit report | Every visit in a date range with duration, distance flag, purpose and remarks |
| Alerts | No check-in by a set time, no visit for a set time, visit outside the geo-fence, day left open (closed at midnight), customers not visited for a set number of days. Managers acknowledge alerts; Admin switches rules on/off and sets limits |

Alert rules are checked whenever someone has Team today or Alerts open (at most once a minute). For checks with nobody looking, have the server call `GET /api/alerts` on a schedule, or wait for the notification service planned with the Android app.

| Selfie | Check-in needs a selfie (switch it off with the `selfie_required` setting). The photo is shrunk on the phone, stored in the database and shown in Team today |
| Tour plan | A field user plans customers per day for a month and submits it; the manager approves or sends it back with remarks. Planned, done and off-plan visits are counted, and planned customers are marked in My day |
| Notices | Head office publishes a notice to everyone, one role or one region, with an end date. Users mark it read; the publisher sees the read count |

Still to come in Phase 2: the Android app (background tracking, mock-location detection, push notifications).

## What Phase 3 adds

| Area | What works now |
| --- | --- |
| Booklet | A request to sell named products to one customer below the trade rate: ask rate, bonus (buy + free), discount %. Net rate and the gap below base rate are calculated; a reason is needed for every line below base |
| Approval chain | The largest gap decides the final approver: up to the ASM band ends at ASM, up to the RSM band at RSM, above that at GM (bands are in Settings). Approve, send back or reject with remarks; nobody approves their own booklet; every step is in the history |
| Credit position | Limit, outstanding with aging, approved-but-not-dispatched value, available credit and instruments are shown on every booklet and order |
| Sales order | Standard rates, or rates locked to one accepted booklet with quantity limited to the booklet balance. Marked Within limit or Over limit |
| Credit Control | Order queue; an over-limit order can be approved only with a remark naming what covers it. Customer limits, instruments (bank guarantee, LC, cheque, director approval), cancel an accepted booklet |
| Outstanding upload | Excel/CSV of customer-wise outstanding with aging buckets, with a per-row error report and upload history. This replaces a link to accounting software |
| Dispatch | Approved orders, daily Excel export (one row per order line) for manual entry, mark dispatched with invoice number |
| New alerts | Approval waiting longer than the set hours; instrument expiring within the set days |

Numbers look like `BK-8384-0001` and `SO-8384-0001`, where 8384 is the Nepali fiscal year 2083/84. The year switch is taken as 16 July; adjust `fyLabel` in `lib/sales.ts` if your books switch on a different day.

Not in this phase: a printable order PDF, and editing a sent-back booklet (the user creates a new one).

## What Phase 4 adds

| Area | What works now |
| --- | --- |
| Collections | Field user records cash, cheque, bank transfer or online payment with a photo; Credit Control verifies it. Verified collections dated after the last outstanding upload are added back to the customer's available credit |
| Expenses | One claim per day: route, km, DA, lodging, other, bill photo. Travel allowance = km × the rate in Settings; DA is capped by Settings. The km is compared with that day's GPS path and flagged (and alerted) when it is above the tolerance. Manager approves, accounts marks paid |
| Claims | Expired stock, near expiry, breakage, rate difference: customer, product, quantity, batch, amount, photo. RSM or GM approves, Credit Control settles |
| Leave | Apply with dates and reason; the manager approves. Approved leave stops the no-check-in alert and shows "On leave" in Team today |
| Distributor stock | Field user reports stock, 30-day sale and near-expiry boxes per product for a distributor. Managers see the latest report with days of cover and filters for reorder, overstock and near expiry |
| Tenders | Register of institutional bids with buyer, value, bid security, closing date, stage and owner; import/export like any master |

Collections, expenses, claims and leave share one engine (`lib/reqdefs.ts` describes the fields and steps, `lib/req.ts` runs them), so a new request type is mostly a definition plus a table.

GPS distance for an expense day uses the location points the app recorded that day. With the browser-only app those points exist only while the page was open, so a low GPS figure is a prompt to ask, not proof; the Android app's background tracking will make it reliable.

## What Phase 5 adds

| Area | What works now |
| --- | --- |
| Targets | GM or Admin sets a monthly rupee target per field person on the scorecard page; every change is in the audit log |
| Control room | For managers the dashboard opens with month sales against target pace, on duty, visits, collection, open alerts and decisions waiting, a cumulative sales chart, achievement by region, latest alerts and top/bottom scores, all limited to their territory |
| Scorecard | Per person: target, approved sales, achievement against pace, collection, visits, days present and late, score out of 100 and incentive. Sortable; the score parts show on hover |
| Incentive | Percent of target at 90% and at 100% achievement, set in Settings; projected from pace during the month |
| My month | A field user sees their own target, sales, score and its parts on the dashboard |
| Reports | 20 Excel reports: attendance, visits, out-of-location, coverage, tour plan vs actual, target and scorecard, order register, product-wise and customer-wise sales, booklet register, rate variance, distributor stock, credit exposure, instrument expiry, collections, expenses vs GPS, claims, leave, alert log, audit log |

Score weights are fixed in `lib/perf.ts`: visits 30, sales 35, collection 20, discipline 15. "Approved sales" counts orders approved by Credit Control in the month, by the date of approval.

Not built yet: the Android/iOS app (background tracking, mock-location detection, push), sample and gift issue, competitor information, a printable order PDF, SMS notifications, BS dates.

## Run it on your own computer (for a developer)

Needs Node.js 20 or newer and PostgreSQL 14 or newer.

```bash
cp .env.example .env          # then edit DATABASE_URL and AUTH_SECRET
npm install
npm run migrate               # creates the tables
npm run seed -- --sample      # roles, settings, admin + example data (leave out --sample for an empty system)
npm run dev                   # http://localhost:3000
```

Log in as `ADMIN` with the password from `DEFAULT_USER_PASSWORD` (default `Everest@123`). You are asked to change it.
With `--sample`, the users `GM01`, `CC01`, `RSM01`, `ASM01`, `SO01` … use the same default password. Every sample record has "Sample" in its name; deactivate or overwrite them before going live.

On plain `http://localhost` set `COOKIE_SECURE=false` only if you run `npm start` (production mode) without https.

## Put it on a server

Needs a Linux server with Docker, and a domain name whose DNS points at the server.

```bash
cp .env.example .env
# edit .env: DB_PASSWORD, AUTH_SECRET (openssl rand -hex 32), DOMAIN, DEFAULT_USER_PASSWORD
docker compose up -d --build
```

This starts PostgreSQL, the app, and Caddy, which gets an https certificate for `DOMAIN` automatically.
The app applies database changes and creates the roles, settings and the first admin on every start; it never overwrites existing data.

The Docker files were written but not run in the build environment (Docker was not available there). The app itself was built and tested against PostgreSQL 16 directly. Have the person who deploys check the first `docker compose up`.

**https is required**, not optional: browsers only allow location sharing on an https address.

### Backup

Run this every night from cron and copy the file to a second place:

```bash
docker compose exec -T db pg_dump -U sfa sfa | gzip > /backups/sfa-$(date +%F).sql.gz
```

Test a restore every few months: `gunzip -c file.sql.gz | docker compose exec -T db psql -U sfa sfa` on a spare machine.

## Map provider

The map is drawn with MapLibre. With `NEXT_PUBLIC_MAP_STYLE_URL` empty it uses OpenStreetMap tiles, which need no key and cover Nepal well. The public OpenStreetMap tile server is meant for light use; for daily use by a whole team, switch to a provider.

To use a Nepali provider such as Baato or Galli Maps:

1. Create an account with the provider and get an API key.
2. Copy the MapLibre / Mapbox GL **style URL** from their documentation, with your key in it.
3. Put it in `.env` as `NEXT_PUBLIC_MAP_STYLE_URL=...` and rebuild (`docker compose up -d --build`).

The exact style URL format was not verified for either provider while building this, so take it from their current documentation. Any provider that gives a MapLibre style URL will work.

## Loading your real data

Import in this order, because later files refer to codes from earlier ones:

1. Regions
2. Areas (needs region codes)
3. Product categories
4. Products (needs category codes)
5. Payment terms
6. Employees (needs role code: `admin`, `gm`, `cc`, `rsm`, `asm`, `so`; region/area codes; manager's employee code). Import managers before the people who report to them, or import twice.
7. Customers (needs area code, payment term code, assigned employee code)

On each master page: Import → Download template → fill it → Upload. Rows are matched on **Code**: an existing code is updated, a new one is added. Rows with a problem are skipped and listed with the reason; fix them and upload again.

Use the customer codes from your accounting software as customer codes here. The outstanding/aging upload in Phase 3 matches on them.

## For the mobile app later

Every screen uses the same JSON API the Android/iOS app will use. Log in with `POST /api/auth/login` and send the returned token as `Authorization: Bearer <token>`.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/auth/me`, `POST /api/auth/password` | Session |
| `GET /api/m/{list}?q=&page=&size=&inactive=1` | List a master (`employees`, `regions`, `areas`, `categories`, `products`, `terms`, `customers`), already limited to the caller's territory |
| `POST /api/m/{list}`, `PUT /api/m/{list}/{id}`, `PATCH /api/m/{list}/{id}` | Add, edit, activate/deactivate |
| `GET /api/m/{list}/options` | Choices for dropdowns |
| `POST /api/m/{list}/import`, `GET /api/m/{list}/export`, `?template=1` | Excel |
| `GET /api/map/customers` | Customers with a location |
| `POST /api/track/ping`, `GET /api/track/latest` | Send own position; read the team's last positions |
| `GET/PUT /api/roles`, `GET/PUT /api/settings` | Administration |
| `GET /api/field/today?lat=&lng=` | The caller's attendance, open visit, today's visits and assigned customers with distance |
| `POST /api/field/checkin`, `POST /api/field/checkout` | Start and end the day (`lat`, `lng`, `accuracy`, `projection` / `actual`) |
| `POST /api/field/visit/start`, `POST /api/field/visit/end` | Customer visit |
| `GET /api/team/today?day=`, `GET /api/visits?from=&to=` | Manager views |
| `GET /api/booklets?box=mine|inbox|all|usable&customer=`, `POST /api/booklets`, `GET/POST /api/booklets/{id}` | Booklets: list, create, detail, act (`approve`, `back`, `reject`, `cancel`) |
| `GET /api/orders?box=mine|queue|approved|all`, `POST /api/orders`, `GET/POST /api/orders/{id}`, `GET /api/orders/export?day=` | Sales orders: list, create, detail, act (`approve`, `reject`, `withdraw`, `dispatch`), daily export |
| `GET /api/credit?customer=`, `GET /api/credit?q=`, `PUT /api/credit`, `POST /api/credit`, `GET/POST /api/credit/outstanding` | Credit position, customer list, set limit, instruments, outstanding upload |
| `GET /api/req/{type}?box=mine|inbox|all`, `POST /api/req/{type}`, `POST /api/req/{type}/{id}` | `collections`, `expenses`, `claims`, `leave`: list, create, act (`next`, `reject`, `withdraw`) |
| `POST /api/photo`, `GET /api/photo/{id}` | Upload a proof photo (JPEG data URL) and read it back |
| `GET /api/stock?customer=`, `GET /api/stock`, `POST /api/stock` | Distributor stock: last report for a customer, latest view, save today's report |
| `GET /api/perf?month=`, `GET /api/perf?view=overview`, `PUT /api/targets`, `GET /api/reports/{key}?from=&to=&month=` | Scorecard rows, control-room summary, set targets, download a report |
| `GET /api/alerts?open=1`, `POST /api/alerts/ack`, `GET/PUT /api/alerts/rules` | Alerts |

## How the code is organised

| Path | What it is |
| --- | --- |
| `db/migrations/` | SQL files, applied in name order by `npm run migrate`. Add a new numbered file for every schema change; never edit an applied one |
| `lib/entities.ts` | Definition of every master: its fields, labels, types and links. Adding a field here adds it to the form, the table, import and export (add the column in a migration too) |
| `lib/crud.ts` | List, save, deactivate for all masters; validation; territory rule; audit |
| `lib/auth.ts`, `lib/perm.ts` | Sessions, permission checks, the permission list |
| `lib/xl.ts` | Excel/CSV import and export |
| `app/api/` | The JSON API |
| `app/(console)/` | The screens |
| `components/` | Shell (menu, effects), Master (the generic list/form), MapView, and smaller forms |

## Known limits

- Location sharing from the browser works only while the page is open and the screen is on. Background tracking needs the Android app (Phase 2).
- A browser location can be faked. Mock-location detection also comes with the Android app.
- "Forgot password" is handled by the Admin setting a new password on the employee form; there is no SMS or email reset yet.
- Dates are stored and shown in AD. BS display is planned with the field app.
- There are no automated tests in the repository yet. The checks done before hand-over are listed in the delivery note.
