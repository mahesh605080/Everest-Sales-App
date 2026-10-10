# Everest Sales App

Web app for the sales team of Everest Parenterals Pvt. Ltd. (Nepal). Its job is to raise sales and cut loss: take orders faster, sell near-expiry stock in time, keep the right stock at each distributor, and let managers see and approve everything from one place.

It does not connect to the accounting software. Stock and outstanding figures come in by Excel upload; approved orders go out as a daily Excel file.

Attendance, leave and expense claims are deliberately not part of this app.

## What it does

### Selling
| Screen | What it does |
| --- | --- |
| Action list (Sales opportunities, My day) | One ranked list of what to do today: near-expiry lots, approved rates not yet ordered, distributors running low, customers who stopped ordering, overdue visits, payments to collect (old dues or orders held for credit) and products that similar customers buy but this one does not. Each can be answered Done, Later or Not interested with a reason |
| Sales orders | Order with live credit check. Repeat last order, suggested order from the distributor's stock, quick entry of all products, overstock warning, print/PDF, share on WhatsApp |
| Booklets | Special-rate requests with approval by level (ASM, RSM, GM) depending on how far below the base rate |
| Schemes | Bonus (10 + 1) and/or discount per product with minimum boxes and dates. Applies itself on the order; the screen nudges "add 2 more boxes to get 1 more free" |
| Price lists | A rate per customer type, or a contract rate for one customer. Orders pick it up automatically |
| Yearly rebate | Slabs on a distributor's purchases in the Nepali fiscal year; shows what is earned and how much more reaches the next slab |
| Scheme results | What each scheme sold, what it gave away, and whether sales went up |
| Tenders | Institutional bids and their stage |

### Stock, expiry and returns
| Screen | What it does |
| --- | --- |
| Stock and expiry | Batch-wise company stock by Excel upload. Expiry ladder, stock that will not sell in time at the current rate, offer slabs for near-expiry lots, "Find buyers" who can use a batch before it expires |
| Near-expiry lot orders | Sold at the offer rate, limited to the batch, marked non-returnable; a later expiry claim on that batch is refused |
| Earliest expiry first | Every order shows which batches to send. Dispatch records the batches that left, takes them out of the company stock, and makes later return claims traceable to the batch |
| Demand plan | Per product: monthly sale, trend, open orders, sellable stock, days of cover and how many boxes to make to hold 60 days of sale |
| Running out | Products whose sellable stock covers fewer than 30 days of sale |
| Short stock | When open orders exceed sellable stock: a fair share per order based on what each customer normally buys |
| Loss and returns | Expired in the godown, expiry returns by month, by customer and product, and what near-expiry selling recovered |
| Claims | Expiry, breakage and rate-difference claims, checked against the returns policy (window, value, traceability, yearly cap). Doubtful claims carry flags; over-cap claims go to the GM |
| Distributor stock | Stock reports from the field; bought vs sold per distributor; suggestions to move stock from an overstocked distributor to one running short |

### Money
| Screen | What it does |
| --- | --- |
| Credit control | Order queue with credit position, limits, instruments (bank guarantee, PDC), outstanding and aging by Excel upload, dispatch, daily export of approved orders |
| Collections | Recorded in the field, verified by Credit Control |

### Field and monitoring
| Screen | What it does |
| --- | --- |
| My day / visits | Customer visits with GPS and a geo-fence check; no day check-in is needed |
| Tour plan | Monthly plan with manager approval; plan vs actual |
| Live map, team visits, day trail | Where customers and people are, and what each person did on a day |
| Customer classes | A/B/C by 12-month sales with a visit norm per class |
| Samples and gifts, competitor information | Recorded in the field, seen by managers |
| Alerts | Visit outside the geo-fence, customers not visited, approvals waiting too long, instruments expiring, stock at risk of expiry |
| Approvals | Everything waiting for a person on one screen, with Approve and Reject in place |
| Dashboard | "Sales and loss today": chances to sell, approvals waiting, stock at risk, products short, expiry returns against the limit; then the control room |
| Customer page | Everything about one customer, including its class, returns allowance, rebate position, own rates and running schemes |
| Targets, scorecard, reports | Monthly targets, achievement, score and incentive; 25 Excel reports |

### Administration
Masters (employees, regions, areas, products, customers, payment terms) with Excel import/export, roles with permissions as data, settings for every limit, notices, notification bell, audit log. Dates are shown in AD and BS; document numbers carry the Nepali fiscal year.

### Safety
Territory rule on every list (a sales officer sees only assigned customers, managers their area or region), temporary passwords must be changed, login lockout, signed session cookie, security headers, every change in the audit log.

## Settings you should review before going live

These defaults were chosen while building; set them to the company's own policy in Settings.

| Setting | Default |
| --- | --- |
| Near-expiry offer slabs | 30% under 3 months, 15% for 3 to 6 months |
| Minimum shelf life to sell | 2 months |
| Returns window | from 3 months before to 6 months after expiry |
| Yearly returns cap | 2% of the customer's 12-month purchases |
| Breakage claim | within 15 days of dispatch |
| Suggested order fills to / overstock above | 45 days / 3 months of sale |
| Visit norm for class A, B, C | 15, 30, 60 days |
| Yearly rebate slabs | none: the GM enters them |

## Checks

`npm run smoke` runs 196 end-to-end checks over the real API, with both services running, against a database freshly loaded with `npm run seed -- --sample`. The platform service has its own 142 tests (`backend/scripts/test.sh`). The phone app has 24.

## Run it on your own computer (for a developer)

Needs Node.js 20 or newer and PostgreSQL 14 or newer.

```bash
cp .env.example .env          # then edit DATABASE_URL and AUTH_SECRET
npm install
npm run migrate               # creates the tables
npm run seed -- --sample      # roles, settings, admin + example data (leave out --sample for an empty system)
npm run dev                   # http://localhost:3000
```

To see every screen filled with realistic figures on a test database, also run `npm run demo` after the sample seed: it adds six months of orders, batch-wise stock, distributor stock reports, outstanding, visits, claims, rebate slabs and targets, all marked DEMO.

Log in as `ADMIN` with the password from `DEFAULT_USER_PASSWORD` (default `Everest@123`). You are asked to change it.
With `--sample`, the users `GM01`, `CC01`, `RSM01`, `ASM01`, `SO01` … use the same default password. Every sample record has "Sample" in its name; deactivate or overwrite them before going live.

On plain `http://localhost` set `COOKIE_SECURE=false` only if you run `npm start` (production mode) without https.

## Put it on a server

Needs a Linux server with Docker, and a domain name whose DNS points at the server.

```bash
cp .env.example .env
# edit .env: DB_PASSWORD, AUTH_SECRET (openssl rand -hex 32), CRON_SECRET, DOMAIN, DEFAULT_USER_PASSWORD
docker compose up -d --build
```

This starts PostgreSQL, the web app, the platform service, and Caddy, which gets an https certificate for `DOMAIN` automatically. Each service applies its own database changes on every start; neither overwrites existing data.

**https is required**, not optional: browsers allow location sharing and push notifications only on an https address.

The full guide, with backup, test restore, restore, upgrading and going back, is [`docs/platform/DEPLOYMENT.md`](docs/platform/DEPLOYMENT.md). Read its first table: the two services and the backup scripts were tested running directly on Linux; the Docker images themselves could not be built on the build machine, so the first `docker compose up` should be watched by someone who can read its output.

### Backup

```bash
docker compose run --rm backup                                   # database + uploaded files, with checksums
docker compose run --rm backup sh /scripts/verify-backup.sh      # proves the newest backup can be restored
```

Schedule both from cron and copy `./backups` to another machine. Details in the deployment guide.

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

Use the customer codes from your accounting software as customer codes here. The outstanding/aging upload matches on them.

## The business API

The phone app (its own repository) and every screen here use this JSON API. A phone logs in through the platform service (`POST /api/v1/auth/login`, see `docs/platform/INTEGRATION.md`) and sends the token as `Authorization: Bearer <token>`; a browser uses the login cookie.

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
| `GET /api/field/today?lat=&lng=` | The caller's open visit, today's visits and assigned customers with distance |
| `POST /api/field/visit/start`, `POST /api/field/visit/end` | Customer visit |
| `GET /api/team/today?day=`, `GET /api/visits?from=&to=` | Manager views |
| `GET /api/booklets?box=mine|inbox|all|usable&customer=`, `POST /api/booklets`, `GET/POST /api/booklets/{id}` | Booklets: list, create, detail, act (`approve`, `back`, `reject`, `cancel`) |
| `GET /api/orders?box=mine|queue|approved|all`, `POST /api/orders`, `GET/POST /api/orders/{id}`, `GET /api/orders/export?day=` | Sales orders: list, create, detail, act (`approve`, `reject`, `withdraw`, `dispatch`), daily export |
| `GET /api/credit?customer=`, `GET /api/credit?q=`, `PUT /api/credit`, `POST /api/credit`, `GET/POST /api/credit/outstanding` | Credit position, customer list, set limit, instruments, outstanding upload |
| `GET /api/req/{type}?box=mine|inbox|all`, `POST /api/req/{type}`, `POST /api/req/{type}/{id}` | `collections`, `claims`, `samples`, `competitor`: list, create, act (`next`, `reject`, `withdraw`) |
| `POST /api/photo`, `GET /api/photo/{id}` | Upload a proof photo (JPEG data URL) and read it back |
| `GET /api/stock?customer=`, `GET /api/stock`, `POST /api/stock` | Distributor stock: last report for a customer, latest view, save today's report |
| `GET /api/perf?month=`, `GET /api/perf?view=overview`, `PUT /api/targets`, `GET /api/reports/{key}?from=&to=&month=` | Scorecard rows, control-room summary, set targets, download a report |
| `GET /api/notifications`, `POST /api/notifications` (`{id}` or `{id:"all"}`) | Bell: unread count and latest 30, mark read |
| `GET /api/sales/opportunities`, `GET /api/sales/last-order?customer=`, `GET /api/sales/suggest?customer=` | The selling list; last order lines; suggested order |
| `GET /api/sales/actions`, `POST /api/sales/actions`, `?view=classes`, `?view=feedback` | Ranked action list, answer an action, customer classes, field answers |
| `GET /api/expiry`, `?batch=&match=1`, `?loss=1`, `?shortage=1`, `?allowance={customer}`, `GET/POST /api/expiry/stock`, `GET/PUT /api/expiry/offers` | Expiry position, buyers for a batch, loss, short stock, returns allowance, stock upload, offer slabs |
| `GET /api/pricing?customer=`, `?results=1`, `GET/PUT /api/rebate`, `GET /api/approvals` | Rates and schemes for a customer, scheme results, yearly rebate, approval inbox |
| `GET /api/stock?view=health`, `?view=transfers` | Bought vs sold, transfer suggestions |
| `GET /api/alerts?open=1`, `POST /api/alerts/ack`, `GET/PUT /api/alerts/rules` | Alerts |

## Platform service (logins, live updates, files, notifications, jobs)

Beside the web app runs a second service, written in Python, in `backend/`. It provides what would otherwise be rented from Firebase or Supabase: login sessions with short tokens for the phone app, live updates and chat, private file storage, notifications with browser and iPhone push, background jobs, and a console for the Super Admin (**Platform console** in the menu). It uses the same database, in its own schema, and the same logins.

Everything about it is in [`docs/platform/`](docs/platform/README.md): how the pieces fit, the developer guide, every API endpoint, what notifications can and cannot do on each kind of device, and the guide for running it.

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

- Location sharing from the browser works only while the page is open and the screen is on, and a browser location can be faked. Background route recording is in the phone app.
- The web app does not work offline. The phone app keeps orders, visits and collections made without a connection and sends them later.
- **The phone app has never been installed on a real phone.** Its logic is unit-tested and its screens were checked in a browser preview.
- **Push notifications have not been sent through a real push service or to a real device.** What each kind of device can and cannot receive is set out in `docs/platform/NOTIFICATIONS.md`; in short, a closed Android app is not woken instantly because Google's messaging service is deliberately not used.
- **The Docker images have not been built.** See the deployment guide.
- There is no two-step login. See `docs/platform/SECURITY.md` for this and the other open security points.
- Live updates and chat run in one service process; that is enough for a few hundred people and is the first thing to change beyond that.
- Company stock goes down when an order is marked dispatched in this app. Anything that leaves the godown another way (direct invoices, samples, breakage) is corrected only by the next stock upload, so upload stock regularly.
- Suggested orders, bought-vs-sold and transfer suggestions need distributor stock reports not older than 45 days.
- A forgotten password is reset with a one-time code issued by an administrator (or by email once a mail server is configured).
- Dates on forms are entered in AD.
