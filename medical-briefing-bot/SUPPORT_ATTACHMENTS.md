# MB-006 Phase 3: secure support attachments

Status: implementation for review; operational feature completion and activation BLOCKED.
No production migration, bucket provisioning, environment change or scanner installation is included.

## Architecture

Customer Admin and Internal Admin retain their existing, separate authentication contracts. Ordinary employees are denied even when CUSTOMER_AUTH_ENFORCEMENT_ENABLED=false. Every attachment endpoint authenticates, checks SUPPORT_ENABLED and SUPPORT_ATTACHMENTS_ENABLED, and verifies request ownership through the existing support RPC. Customers can access only their own requests. Internal operators use the existing password-session authentication. Mutation APIs require the same origin.

The browser receives a random 256-bit grant with a five-minute expiry. Only its SHA-256 is stored. The grant is bound to an attachment, request and authenticated audience through every API call. Grants are renewed by preparing the same client_key; previous grants stop working. A request row lock serializes reservation, enforcing at most five active attachments including incomplete uploads. Same-key retries reuse the UUID and completed parts; changed metadata and duplicate active file hashes conflict.

Uploads use authenticated 1 MiB chunks. A Next.js invocation buffers at most one chunk, never an entire 10 MiB file. A chunk claim has a one-minute lease and unique immutable object path; retries cannot overwrite an existing object. Completion requires exactly the expected parts and byte sum. Browser hashing may read a 10 MiB file locally. Progress advances after each acknowledged chunk.

Direct signed Storage uploads are intentionally not issued: Supabase signed upload URLs have a fixed two-hour lifetime. The five-minute application grant gives the required short authorization lifetime and avoids a single 10 MiB serverless request.

## Storage and database

`supabase/migrations/20261016035115_support_attachments.sql` adds:

| Table | Purpose |
| --- | --- |
| support.support_attachments | UUID, request, idempotency key, original name, MIME, size, full SHA-256, uploader kind/identity, upload/scan states, expiry, clean path, creation/deletion times |
| support.support_attachment_parts | Chunk size/hash, immutable quarantine path, ready flag and lease |
| support.support_attachment_objects | All reserved object paths, including failed/replaced uploads and abandoned scan promotions, for orphan cleanup |
| support.support_attachment_audit | Reservation, upload, deletion, download, scan and retention events |
| support.support_request_upload_keys | Owner-scoped request creation retry key and payload, recovering a lost create response without duplicate requests |

All five new tables enable and force RLS. PUBLIC, anon and authenticated have no table or RPC privileges. Only the existing trusted service_role server can call the invoker RPCs. Customer-facing projections omit object paths, token hashes, scanner leases and uploader identities. No service key is returned to the browser.

`supabase/provisioning/support_attachment_storage.sql` is a separate, explicit provisioning artifact. It creates `support-quarantine` (1 MiB objects, octet-stream) and `support-clean` (10 MiB, six allowed MIME types), both private. A restrictive storage.objects policy blocks direct anon/authenticated access even if another permissive policy exists. It refuses to overwrite buckets with the same IDs. It has NOT been applied.

Paths are exclusively `<request UUID>/<attachment UUID>/<object UUID>`; the client cannot choose a bucket or path. Quarantine chunks and clean objects are immutable. Downloads proxy the private clean stream through an authenticated endpoint; no reusable Storage URL is exposed.

## API contract

Base: `/api/customer-admin/support/requests/:id/attachments` or `/api/admin/support/requests/:id/attachments`.

| Method and suffix | Request / response |
| --- | --- |
| GET base | Public metadata list, excluding soft-deleted files |
| POST base | JSON: client_key UUID, original_name, mime, bytes, sha256; returns id, token, expires_at, uploaded, part_bytes=1048576 |
| POST /:attachmentId/parts/:part | application/octet-stream, x-support-upload-token; exactly the expected chunk size; returns ok |
| POST /:attachmentId/complete | x-support-upload-token; verifies parts and queues pending scan |
| GET /:attachmentId/download | Only clean; streams attachment with no-store, nosniff, same-origin CORP and sandbox CSP |
| GET /:attachmentId/download?preview=1 | Inline only for clean JPEG/PNG/WEBP; documents remain attachments |
| DELETE /:attachmentId | Soft deletion, immediately denies subsequent reads/downloads |

Errors: 400 invalid metadata/parts, 401 missing/expired session, 403 wrong audience/origin/expired upload grant, 404 unknown or foreign request/attachment, 409 conflicting reservation/lease, 413 chunk over 1 MiB, 423 quarantine, 503 disabled/unavailable. Request count violations use 400. Unknown internal errors are masked. In-flight streams already authorized before deletion cannot be recalled.

## Validation and malware scanning

Allowed: JPG/JPEG, PNG, WEBP, PDF, DOCX, XLSX, up to 10 MiB and five files/request. Reservation checks extension/MIME, safe filename, size and SHA-256 syntax. Before malware scanning, the worker spools chunks to a temporary 0600 file while checking order, byte counts and chunk hashes, then verifies full SHA-256 and file signature against extension/MIME. Office ZIP validation rejects encryption, path traversal, duplicate names, executable/macro entries, missing main XML, format disguise, excessive entries, expansion size and ratio. Signature validation is not a complete image/document decoder or content sanitizer.

States: pending -> scanning -> clean/infected/failed. A service-only worker claim uses SKIP LOCKED and a five-minute lease. Results bind the current lease, expected hash and exact clean path. Duplicate, forged, expired or deleted-file results are rejected. Only clean is downloadable for both audiences. Scanner absence, connection failure, timeout, malformed result or format mismatch never permits download.

Production adapter: `frontend/src/lib/support/attachments/scanner.mjs`, ClamAV clamd INSTREAM over TCP, 120-second absolute deadline, bounded response, exact OK/FOUND parsing. It does not install/start ClamAV or activate a service. Clamd TCP has no built-in authentication/TLS: deploy only on a controlled private network or authenticated TLS tunnel after security approval. Signature database freshness, engine limits, health monitoring and real malicious/clean corpus acceptance remain mandatory and unverified.

Test scanners exist only under tests/fixtures. There is no production switch to return a mock clean verdict. `frontend/scripts/scan-support-attachments.mjs` processes one job per invocation. An approved external worker supervisor must poll/drain the queue; no Collector or workflow scheduler is changed. Failed scans remain blocked; remove and re-upload to retry after the engine issue is resolved. Do not invoke this CLI against production during this phase.

## UI and retry

Customer `/customer-admin/support`: mobile multiple file selection, remove before reservation, local image previews with revoked object URLs, paste images in the attachment area, filename/size, per-chunk progress and retry. Creation uses optional x-support-request-key UUID when attachments are enabled; the existing JSON contract is unchanged. A customer-owned transaction advisory lock and persistent key mapping make response-loss retries return the same request, with changed-payload reuse rejected. After request creation, its ID is retained while attachments retry; a partial upload failure preserves fields/files and cannot create another request. The dialog can move to the already-created detail for recovery. Closing/reloading the browser does not persist local File objects or retry keys; the existing request remains available and incomplete server reservations can be deleted from detail.

Both detail screens show scan state, authenticated clean image preview/download, quarantine/failure messages, refresh and soft deletion. Pending/scanning/infected/failed server files never have a preview/download URL rendered. The attachment flag defaults off; the underlying Phase 1/2 screens remain usable without it. Chromium mobile emulation is covered; actual iOS Safari/clipboard behavior requires device acceptance.

## Retention, audit and rollback

`frontend/scripts/cleanup-support-attachments.mjs` runs a bounded batch (100 objects), using service-only worker RPCs. It invalidates reserved uploads whose grant expired over 24 hours ago. Quarantine objects become removable after seven days when their attachment is deleted or scan-final. Clean orphans become removable after 30 days; a live clean path is retained, and a soft-deleted clean path waits 30 days after deletion. Every path is registered before storage writes, so failed writes, replaced parts and stale promotions are recoverable. Storage deletion failures retain records for retry. Physical deletion succeeds before recording completion; repeated maintenance is safe. Uploaded pending files remain blocked and retained until scanning or operator deletion; alert on a stuck queue.

Retention values are proposed defaults requiring owner approval before activation. Audit/metadata are retained, with no automatic hard purge. Legal retention, deletion requests, backup retention, restoration and audit access/export need an approved operational policy. These CLIs are neither scheduled nor executed against production here.

Apply only after a separately approved staging trial and migration-history review: foundation migration, attachment migration, then explicit bucket provisioning. Verify grants/RLS, storage policy interactions, private bucket metadata and real PostgREST calls. Production currently has no support schema/buckets in read-only checks; pre-existing migration-history discrepancies remain unresolved. Never run history repair as part of this change.

Rollback preference: disable the new attachment flag, stop workers, revert application commit; retain DB/Storage data and audit for investigation. No destructive down migration is supplied. Do not run the Phase 1 empty-only rollback with attachment objects installed: dependent objects cause refusal. Any future destructive rollback must separately lock/check all attachment tables and account for bucket contents under explicit approval.

## Conflict-code correction

`supabase/migrations/20261019041429_support_conflict_sqlstate.sql` must follow the foundation and attachment migrations, before activation. It changes deliberate business-conflict errors in four existing functions from SQLSTATE `40001` to `PT409`. PostgREST 14 can repeatedly retry `40001` transactions instead of returning the conflict; `PT409` returns HTTP 409 immediately. The application maps both codes to the existing `VERSION_CONFLICT` response, so application rollout can precede the separately approved database update. Genuine PostgreSQL serialization failures retain their original handling.

The correction uses the four exact function signatures and replaces only the existing error-code literal through `CREATE OR REPLACE FUNCTION`. Function OIDs, grants, invoker security, search paths, locks and data remain unchanged. If a function is missing or lacks the expected literal, the entire transaction aborts for drift review. Existing migrations are immutable. The native CI test uses an isolated PostgreSQL 17 database and real PostgREST 14.5 to verify stale versions, duplicate requests/files, chunk/scan leases, reservation limits and public access denial; it does not provision production resources.

No destructive rollback is needed. Keep support disabled and retain the corrected SQL when reverting application code: the previous application may surface conflicts as 503 until the compatible application is restored. Do not restore `40001` for business conflicts on PostgREST 14. Before any target migration, review history and backups under separate approval. See the [Supabase PostgREST 14 retry advisory](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b).

## Activation gates and validation limits

Operational feature completion is BLOCKED until a real approved malware service and secure connection are available and tested. Also required: non-production Supabase Storage/PostgREST acceptance, migration-history procedure, private bucket provisioning, worker/cleanup supervisor, monitoring, approved retention, target serverless chunk/stream limits, iOS Safari acceptance and an explicit activation approval.

Local tests use PGlite, a network-isolated PostgreSQL 17 container, Mock Storage and mock scanner/protocol servers. They do not establish real Supabase Storage behavior or actual malware detection quality. Existing critical/high dependency advisories must be assessed separately before deployment; no broad dependency upgrade is included.

Environment contract (not configured here): existing SUPPORT_ENABLED, NEXT_PUBLIC_SUPABASE_URL and server-only SUPABASE_SERVICE_ROLE_KEY; new SUPPORT_ATTACHMENTS_ENABLED, worker-only SUPPORT_CLAMAV_HOST and optional SUPPORT_CLAMAV_PORT (3310). Never expose scanner/service credentials in NEXT_PUBLIC variables.
