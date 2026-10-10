# Security: threat model and checklist

What could go wrong, what stops it, and how each control was checked. "Tested" names the automated test or the manual check; anything not tested says so.

## What is being protected

1. **Customer and commercial data**: customers, prices, schemes, orders, credit limits, outstanding, collections.
2. **People's accounts**: passwords, logins, the ability to approve.
3. **Uploaded files**: cheque photos, rate letters.
4. **The service itself**: staying up through the working day.

## Who might attack

| Who | What they have | What they want |
|---|---|---|
| A stranger on the internet | The site's address | Any way in; to knock it over |
| A competitor's contact | Possibly a former employee's password | Prices, customers, schemes |
| A field employee | A valid low-level login | To see or change what is above their role; to fake visits |
| A manager | A valid mid-level login | To approve their own requests; to act on people above them |
| Someone holding a lost or stolen phone | The installed app, maybe unlocked | The owner's access |
| A hostile website open in a logged-in browser | The victim's cookie, sent automatically | To act as the victim |
| A compromised push service or network | Messages in transit | To read or forge notifications |

Not defended against: someone with administrator access to the server or the database; a Super Admin acting in bad faith (the audit log records, it does not prevent); a phone with malware that reads the screen.

## Threats and controls

### Getting in without a password

| Threat | Control | Checked by |
|---|---|---|
| Guessing passwords | Account locks for 15 minutes after 5 wrong tries; 20 failures from one address locks that address out; counts are in the database, so a restart does not reset them | `test_account_locks_after_five_wrong_passwords`, `test_one_network_address_is_limited_across_accounts` |
| Finding out which codes exist | Wrong password, unknown person and inactive person give the same answer | `test_wrong_password_unknown_user_and_inactive_all_look_the_same` |
| Stolen password database | Argon2id; older bcrypt hashes are upgraded at next login; never reversible | `test_old_bcrypt_hashes_still_verify_and_new_ones_are_argon2id` |
| Forged token | Signed with a server secret of 32+ characters; "no signature" tokens, another secret, a changed body, a missing expiry, an expired token, another person's login id are all refused | `test_forged_and_borrowed_tokens_are_refused` |
| Weak secret in production | The service refuses to start | `test_production_refuses_a_weak_secret` |
| Stolen phone token | Access token lasts 15 minutes; refresh token works once; a replayed one ends the whole login; tokens sit in the phone's keystore | `test_refresh_rotates_…`, `test_two_refreshes_at_once_…` |
| Stolen browser cookie | http-only, same-site, secure; tied to a login that can be ended from anywhere; ended automatically after 7 unused days | Manual check in the Phase 9 report; `test_a_browser_login_left_unused_is_ended_…` |
| Someone left the company | Deactivating the person stops every token at once | `test_deactivating_a_person_stops_their_tokens_and_refresh` |
| Guessing a reset code | 59 bits, single use, 30 minutes, 8 tries per 15 minutes | `test_admin_reset_code_is_single_use_…`, `test_reset_guessing_is_rate_limited` |

### Doing more than the role allows

| Threat | Control | Checked by |
|---|---|---|
| Calling an API the screen does not show | Every endpoint checks the permission on the server; screens only hide | Each module's tests, and the web suite (`a field officer cannot …`) |
| Acting on someone senior | Below the Super Admin nobody can change, reset, suspend or log out a person at or above their own level, or grant a permission they do not hold | `test_admin_actions_respect_levels`, web suite |
| Reading someone else's file, document, chat | Owner checks on the server; "not yours" answers 404, the same as "not there" | `test_private_by_default_and_sharing`, `test_data.py`, `test_realtime.py` |
| Reading chat through the notification history | The push for a chat message is recorded as "Chat message" without its text; system-made notifications are listed only for whoever manages notifications; senders see only their own | `test_what_was_said_in_chat_is_not_readable_from_notification_history`, `test_senders_see_and_withdraw_only_their_own` |
| Listening to someone else's live channel | Every subscription is checked against the person's role, area and region; unknown channel names are refused | `test_realtime.py` channel tests |
| Sending notifications to everyone | Separate permission for a role, area, region, everyone, more than 200 named people, or anything marked urgent; rate limit of 30 per 10 minutes | `test_sending_needs_permission_and_broadcast_needs_more`, `test_a_person_cannot_flood_chat_or_notifications` |
| Using the admin console | Super Admin only, and not on a temporary password | `test_only_the_super_admin_and_only_known_kinds`, web suite |

### Hostile input

| Threat | Control | Checked by |
|---|---|---|
| SQL injection | Every value is a query parameter; table names in the database view come from the database's own catalogue | `test_hostile_text_is_only_ever_data` (ten attack strings against eleven inputs; tables intact) |
| Running code through the admin | No SQL box, no command box; jobs are a fixed list with bounded whole numbers | `test_only_the_super_admin_and_only_known_kinds` |
| Script in a message or name | Stored as text, returned as JSON with `nosniff`; the web app escapes on display; strict content-security-policy | `test_text_with_markup_is_stored_as_text_…` |
| Dangerous upload | Type decided from content, not name; programs, HTML, SVG, scripts, macro documents refused; stored under random names outside the web root; served as attachment with a sandbox policy | `test_content_decides_the_type_not_the_name`, `test_names_are_only_labels` |
| Path tricks in file names | Names are labels only; storage keys are random | `test_names_are_only_labels` |
| Making the server call an internal address (through a push registration) | Only known push services, https only; checked at registration and again before every send | `test_subscription_rules`, `test_an_endpoint_outside_the_allowlist_is_never_called` |
| A push that opens a phishing page | Links must be plain in-site paths (forms a browser would read as another site, such as a backslash after the first slash, are refused); the service worker, the bell and the phone app each check again | `test_bad_requests_are_refused`, browser check, `notify.test.ts` |
| Text the database cannot store | Answered as "wrong input", not a server error | `test_hostile_text_is_only_ever_data`; found and fixed in this phase |

### Cross-site attacks on a logged-in browser

| Threat | Control | Checked by |
|---|---|---|
| Another site submitting a form as the user | Cookie is same-site; changing requests must carry this site's own Origin; requests the browser marks as cross-site are refused | `test_a_cookie_only_works_for_changes_coming_from_our_own_pages` |
| Another site reading API answers | No cross-origin permission unless an origin is listed in `CORS_ORIGINS` | `test_other_sites_get_no_cors_permission` |
| Another site opening the live connection with the user's cookie | Origin checked on the socket | `test_the_live_connection_needs_a_login_and_ignores_a_cookie_from_another_site` |
| Framing the site | `X-Frame-Options: DENY`, `frame-ancestors 'none'` | `test_every_response_has_request_id_and_security_headers` |

### Leaks

| Threat | Control | Checked by |
|---|---|---|
| Secrets in logs | Passwords, tokens and keys are never logged; a filter hides such fields even if passed by mistake | `test_passwords_and_tokens_never_reach_the_log` |
| Internals in error messages | A crash answers with a generic sentence and an id; the detail is only in the server log under that id | `test_a_crash_tells_the_caller_nothing_and_the_log_everything` |
| Secrets through the admin console | Password hashes, token hashes, push keys and endpoints are masked in the table view; the overview never contains a secret or the database address | `test_the_database_view_masks_every_secret_column`, `test_the_overview_shows_the_state_and_no_secrets` |
| Push content read in transit | Encrypted for the one browser; verified by decrypting with its key and failing with another | `test_web_push_is_encrypted_for_the_browser_and_signed_by_us` |
| Notifications on a device after logout, or for the previous person on a shared browser | A device registration dies with its login; when another person logs in on the same browser, what was queued for the first is withdrawn and the sender refuses a mismatch | `test_push_stops_when_the_login_on_that_device_ends`, `test_what_was_queued_for_one_person_never_reaches_the_next_person_on_that_browser` |
| Secrets in the repository | None found by pattern search; `.env` is ignored | Manual scan, Phase 9 |
| API description in production | Interactive pages switched off | `test_the_interactive_api_pages_are_off_in_production` |
| Backups | Written with owner-only permissions; contain everything, including password hashes | Manual check; see "Open points" |

### Staying up

| Threat | Control | Checked by |
|---|---|---|
| Request flood from one address | 1,200 requests a minute per address (an IPv6 /64 counts as one), then 429; only the bare "alive" check is exempt; memory use bounded | `test_flood_ceiling_per_address`, `test_flood_counter_cannot_fill_the_memory` |
| Huge request bodies | 1 MB limit on every address, enforced while the body is read and before any login check. Only the one upload address accepts more (a file's worth, 10 MB) | `test_oversized_body_is_refused`, `test_nobody_can_send_a_huge_body_to_any_address_before_logging_in`, `test_size_limit_and_quota` |
| Filling the disk with files | Per-person allowance; upload rate limit; disk alert | `test_size_limit_and_quota`, monitor tests |
| Chat or notification spam | 60 messages a minute; 30 sends per 10 minutes; 30 notifications per person per hour | `test_a_person_cannot_flood_chat_or_notifications`, `test_too_many_in_an_hour_are_held_back` |
| Slow live clients | Dropped and told to reconnect | `test_realtime.py` |
| A worker crash mid-job | Work returns to the queue. Two workers never take the same item. After a crash in the middle of sending, the pushes that were on the wire are sent again (the device shows one); nothing is lost | `test_two_workers_never_take_the_same_job_…`, `test_a_batch_is_claimed_by_one_worker_only_…` |

## Dependencies

| Project | Tool | Result on the day of the Phase 9 report |
|---|---|---|
| Platform service (Python) | `pip-audit -r requirements.txt` | No known vulnerabilities |
| Web app | `npm audit --omit=dev` | 0 after this phase. Before: 5 (map library XSS sanitizer flaw, rated critical; PostCSS; uuid). Fixed by moving the map library from 4.7 to 6.13 and pinning fixed versions of the other two |
| Phone app | `npm audit --omit=dev` | 41 findings, all from five packages. Four are build tools that never run on the phone (bundler, test runner, signing tool, project generator) and have no fixed release. One, a URL-decoding helper inside the router, runs in the app: a malformed link can make it slow. Its fix is a version the router cannot load. Left as is; revisit at the next Expo upgrade |

Run the three commands again before each release.

## Open points, stated plainly

- **No two-step login (MFA).** The strongest missing control for the Super Admin and Credit Control accounts.
- **Backups are not encrypted by the script.** Keep them on an encrypted disk and copy them off the server over an encrypted channel.
- **The browser cookie is long-lived** (30 days) but is checked against the login list on every request and ended after 7 unused days, so in effect it is a session reference, not a bearer token that outlives a logout.
- **No virus scanning** of uploads.
- **No web application firewall** or fail2ban; the flood limit is per address and in memory.
- **Mock-location detection** depends on the phone reporting it honestly.
- **No independent penetration test** by people has been done. The tests above are the author's own, plus one separate automated code review at the end of Phase 9 whose findings (two serious, several smaller) were fixed and are listed in that phase's report.
- **The flood limit is in memory** and is reset if more than 20,000 different addresses appear within a minute; it stops a runaway script, not a distributed attack.
- **A request body sent without a declared length and over the limit** is cut off correctly but answered with 400 rather than 413.
- **Email verification and self-service account deletion** do not exist; accounts are made and removed by administrators.

## Before going live: checklist

- [ ] `AUTH_SECRET` is 32+ random characters, different from any test value, and stored only in the server's `.env`
- [ ] `DB_PASSWORD` is long and random; the database port is not open to the internet (the compose file does not publish it)
- [ ] `DEFAULT_USER_PASSWORD` changed from the example; the Super Admin has logged in and set their own password
- [ ] Sample people and customers removed or deactivated
- [ ] `PLATFORM_ENV=production` and the site opens only over https
- [ ] Server firewall allows only ports 80, 443 and your SSH port
- [ ] Nightly backup scheduled, copied off the server, and one test restore done (see `DEPLOYMENT.md`)
- [ ] `CRON_SECRET` set (16+ random characters)
- [ ] VAPID keys generated on the server, private key not copied anywhere else
- [ ] An outside uptime check on `/api/v1/health/ready`
- [ ] The three dependency checks above are clean, or each finding is understood
- [ ] Roles reviewed: who has `notify.broadcast`, `files.manage`, `employees.edit`, `audit.view`
