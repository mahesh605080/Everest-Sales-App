# Phase 5 report — file storage

**Status: complete and tested.**

1. **Features.**
   - Upload (`POST /api/v1/files`), list (mine, shared with me, all for `files.manage`), details, download, rename and move to a folder, delete, share, time-limited link, history.
   - **Private by default.** A file is visible to its owner only, until the owner shares it with named people, a role, or everyone. A file you may not see answers 404. Only the owner (or `files.manage`) can rename, share or delete.
   - **The content decides the type.** The first bytes are inspected; the claimed type and the name are not trusted. Accepted: JPG, PNG, WEBP, GIF, PDF, XLSX, DOCX, PPTX, CSV, TXT. Refused: programs, HTML, SVG, scripts, unknown binaries, Office files with macros, plain zip archives, and any file whose name ending does not match its content.
   - **Names are labels.** Files are stored under a random 48-character key in a sharded directory; what the person typed never becomes part of a path. Directory parts in names and folders are stripped.
   - **Limits.** 10 MB per file and 200 MB per person by default, both configurable; a personal allowance can be set by the Super Admin. An upload is refused the moment it passes the limit and the partial file is removed.
   - **Downloads** are sent with `nosniff`, a sandboxing content-security-policy and `attachment`; only images and PDF may be shown inline.
   - **Signed links**: HMAC over file id and expiry with a key derived from the server secret, valid at most one hour by default. Deleting the file kills its links.
   - **History** of every upload, download, rename, share, link and delete. **Usage report** in total, by type and per person.
   - Delete is soft; the bytes are removed seven days later by `purge_deleted` (scheduled in Phase 7).
   - **Replaceable backend**: everything goes through a `Storage` interface. A local-disk backend is used; an in-memory one in the tests proves the rest of the code does not depend on the disk.
   - Web app: `lib/files.ts` helper and a Files screen (add, download, link for one hour, share with all, make private, delete, allowance bar).
2. **Existing files modified.** `backend/app/config.py`, `app/main.py`, `requirements.txt`; web `lib/perm.ts`, `scripts/seed.ts`, `scripts/smoke.ts`, `app/(console)/layout.tsx`, `docker-compose.yml`.
3. **New files.** Backend `app/models/files.py`, `app/services/storage.py|filetypes.py|files.py`, `app/routers/files.py`, `migrations/versions/0005_file_storage.py`, `tests/test_files.py`. Web `lib/files.ts`, `components/Files.tsx`, `app/(console)/files/page.tsx`, `db/migrations/024_files_permission.sql`.
4. **Migrations.** Platform `0005` (files, file_shares, file_events, user_quotas). Web `024` (permissions `files.use` for all roles, `files.manage` for the Super Admin). Applied.
5. **Tests run.** Backend 69 passed (10 new). Web suite 184 passed (5 new, through the web address with the browser cookie).
6. **Existing versus new failures.** None.
7. **Security controls verified by test.** Type spoofing (a program named `.jpg`, a JPG named `.pdf`, HTML and SVG named `.txt`, a macro workbook, a fake zip) refused with 415; path traversal in names and folders neutralised and nothing written outside the storage directory; size limit and allowance enforced during the upload; owner isolation; shared-with is not owner; signed link refused when tampered, when its expiry is altered, when expired and after deletion; the storage adapter refuses any key that is not its own.
8. **Limitations.**
   - Only the local-disk backend is implemented. An S3-compatible one would be one class implementing the same four methods; it is not written.
   - No virus scanning. Type checks stop the common tricks, not a malicious PDF or image exploit.
   - The existing visit and claim photos still live in the database table `photos`; they have not been moved to the file store.
   - The mobile app has no files screen yet.
   - Files larger than 2 MB that are Office documents cannot be opened for inspection and are refused.
9. **Configuration.** `FILES_DIR` (a volume in production; `docker-compose.yml` mounts one), `FILE_MAX_BYTES`, `FILE_QUOTA_BYTES`, `FILE_LINK_MAX_SECONDS`.
10. **Commands.** As before.
11. **Next.** Phase 6, notifications.
