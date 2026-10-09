# Everest SFA — Phase 1

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

Not in Phase 1: attendance, visits, booklets, sales orders, credit control, collections, expenses, targets, reports, the Android app. They are listed in the left menu under "Coming next".

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
