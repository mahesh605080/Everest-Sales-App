# Phase 3 report — data APIs and administrative controls

**Status: complete and tested.**

1. **Features.**
   - **Document store** (`/api/v1/data/{collection}`): collections are defined by the Super Admin with declared fields (string, text, integer, number, boolean, date, datetime, enum, json), a read rule and a write rule (`owner`, `authenticated`, or a permission), a size limit per document and a count limit per person. Create, read, partial update with optional version check, soft delete, list with filtering on declared fields (`=`, `gte`, `lte`, `gt`, `lt`, `in`), sorting, text search and paging (at most 100 per page).
   - Every document is validated on the server against the collection's fields; unknown fields are refused. Another person's private document answers 404, not 403.
   - A collection's fields may be added or relaxed but not retyped, so stored documents stay valid. Switching a collection off keeps its documents.
   - Collections marked `audited` write every change to the existing audit log.
   - **Database view for the Super Admin** (`/api/v1/admin/db/...`): tables with size and row estimate, index usage, both migration tracks, connections, and a read-only page of records with secret columns masked. There is no SQL box and no write path.
   - The business data keeps its own purpose-built, transactional tables and routes in the web app; this store is for flexible data that does not deserve a table.
2. **Existing files modified.** `lib/perm.ts` (new permission `data.manage`), `backend/app/main.py`, `backend/app/models/__init__.py`.
3. **New files.** `backend/app/models/data.py`, `app/services/documents.py`, `app/routers/data.py`, `app/routers/admin_db.py`, `migrations/versions/0003_document_store.py`, `tests/test_data.py`, `tests/helpers.py`; `db/migrations/022_platform_permissions.sql`.
4. **Migrations.** Platform `0003` (collections, documents with a JSONB GIN index). Web `022` (gives `data.manage` to the Super Admin role). Both applied.
5. **Tests run.** Backend 44 passed (9 new).
6. **Existing versus new failures.** None.
7. **Security controls verified by test.** Field names in filters and sorts are accepted only if declared, so text such as `';drop table` is refused with 422 and nothing is executed; owner isolation; permission rules for read and write; quota and size limits; the database view refuses other schemas and catalogue tables, masks `password_hash` and `token_hash`, and has no write method.
8. **Limitations.** Equality filters use the JSONB index; range filters and sorting on a field scan the collection, which is acceptable only because collections are bounded by the per-person limit. There are no per-field database indexes created at run time. Realtime publication of document changes arrives in Phase 4.
9. **Configuration.** None new.
10. **Commands.** As Phase 1.
11. **Next.** Phase 4, realtime.
