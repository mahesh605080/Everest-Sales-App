# Phase 2 report — authentication, sessions, roles

**Status: complete and tested, with the limits listed in section 8.**

1. **Features.**
   - `POST /api/v1/auth/login` returns a 15-minute access token and a 30-day refresh token; the refresh token is rotated at every use and only its SHA-256 is stored.
   - Refresh reuse: a refresh token shown again more than 30 seconds after it was used is treated as stolen and ends the whole login. Inside 30 seconds it is accepted, because a phone that lost the answer must be able to repeat the call.
   - Logins are records (`platform.sessions`) tied to a device (`platform.devices`): list own logins, end one, end all; an administrator can end all logins of a person below them.
   - Passwords are Argon2id. Old bcrypt hashes still verify and are replaced at the next login, by either service.
   - Password change signs out every other device and keeps the current one. Password reset by a single-use code that expires in 30 minutes: by email when SMTP is configured, otherwise issued by an administrator and passed on by phone. The reset answer never reveals whether an account exists.
   - Failed-login protection: account lock after 5 wrong passwords for 15 minutes; 20 wrong logins per network address; reset-code guessing limited. All counters are in the database.
   - Login history (`platform.login_events`): every success, refusal, refresh reuse, logout, reset and forced logout, with address and device.
   - Suspend, activate, force logout and reset code for administrators, written to the existing audit log.
   - **Level rule, in both services:** below the Super Admin (level 5) nobody may create, edit, suspend or reset a person at or above their own level, give a role at or above their own level, change a role at or above their own level, or add a permission they do not hold.
   - **One identity for both services.** The web app's cookie login now also creates a login record, so it is listed and can be ended singly; logging out on the web ends the login, not just the cookie. A sign-out made by either service stops the other's tokens, including refresh.
   - **Mobile app:** logs in through the platform, keeps both tokens in the encrypted keystore, refreshes automatically (one refresh at a time) and stays logged in after a password change.
2. **Existing files modified.** Web: `lib/auth.ts`, `app/api/auth/login|logout|password/route.ts`, `lib/crud.ts`, `app/api/roles/route.ts`, `scripts/seed.ts`, `scripts/smoke.ts`, `next.config.mjs`, `package.json`. Mobile: `src/lib/api.ts`, `src/lib/session.tsx`, `src/app/password.tsx`.
3. **New files.** Backend: `app/security.py`, `app/deps.py`, `app/models/auth.py`, `app/services/auth.py|ratelimit.py|mail.py`, `app/routers/auth.py|admin_users.py`, `migrations/versions/0002_*.py`, `tests/test_auth.py`. Web: `lib/password.ts`. Mobile: `src/lib/flight.ts`.
4. **Migrations.** `0002` (devices, sessions, refresh_tokens, login_events, password_resets, rate_limits, all in schema `platform`). Applied. No existing table changed.
5. **Tests run.** Backend 35 passed (26 of them authentication). Web end-to-end 175 passed, including 18 new cross-service checks run through the web address. Mobile 12 unit tests passed; login, automatic refresh after a bad access token, and logout were exercised in the browser preview against both services. Linter clean, both type checks clean.
6. **Existing versus new failures.** None. The 157 earlier web checks still pass.
7. **Security controls verified by test.** Wrong password, unknown user and inactive account are indistinguishable to the caller; forged, expired and `alg: none` tokens are refused; a cookie request from another site is refused; refresh rotation and reuse detection; per-login revocation honoured by both services; password hashes cross-verify between Node and Python; reset codes are single-use, expire, are bound to one person and are rate-limited; level rule.
8. **Limitations.**
   - The browser still uses one 30-day cookie. It is now revocable singly and at logout, but it is not yet a short token with refresh; that needs a change to how server-rendered pages read the session and is listed for Phase 9.
   - Multi-factor authentication is not built (the brief marks it as optional and later).
   - Account deletion is not offered: orders, visits and the audit log refer to people, so an account is suspended, never erased. A retention policy is a Phase 9 item.
   - Email verification is not built; email is used only for reset links.
   - SMTP sending is tested with a stand-in mailbox, not a real mail server.
   - The mobile app has still not run on a real phone, so the keystore path is unproven there.
9. **Configuration.** Optional: `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`, `REFRESH_GRACE_SECONDS`, `LOGIN_MAX_FAILS`, `LOGIN_LOCK_MINUTES`, `LOGIN_MAX_FAILS_PER_IP`, `PASSWORD_RESET_MINUTES`, `PUBLIC_URL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`.
10. **Commands.** Backend tests: `PG_ADMIN_URL=... backend/scripts/test.sh`. Web suite: start the web app and the platform service on a fresh sample database, then `BASE_URL=... npm run smoke`.
11. **Next.** Phase 3, data APIs and administrative controls.

### Who is who
| Brief | In this system |
| --- | --- |
| Super Admin | role `admin`, level 5 |
| Admin | any role given `employees.edit` / `roles.manage` by the Super Admin; bound by the level rule |
| Standard user | field and office roles (`so`, `asm`, `rsm`, `cc`, `gm`) |
| Custom roles and permissions | the existing roles table: permissions are data and editable |
