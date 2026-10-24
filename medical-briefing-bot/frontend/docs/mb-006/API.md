# MB-006 Phase 1 API contract

## Scope and authentication

No customer/admin UI, menus, attachments, buckets, initial requests or collector changes are included.

Customer endpoints accept only the existing Customer Admin session. They do not accept ordinary employee sessions or the Internal Admin cookie. Internal endpoints accept only the existing Internal Admin signed session. Cookies are validated on the server; customer session validity and ownership are rechecked in the database transaction. `CUSTOMER_AUTH_ENFORCEMENT_ENABLED=false` never disables these checks.

`SUPPORT_ENABLED` is server-only and defaults to disabled unless its value is exactly `true`. Authentication happens first. An authenticated caller receives `503 {"error":"SUPPORT_DISABLED"}` when disabled; unauthenticated/wrong-role requests still receive 401/403. Customer authentication also requires the existing `CUSTOMER_AUTH_FOUNDATION_ENABLED=true`; missing configuration fails closed with 503.

Existing environment variables are reused: `NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CUSTOMER_AUTH_FOUNDATION_ENABLED`, and `ADMIN_PASSWORD`. No new secret is required. The public Supabase URL is fixed by the Next build; an environment change requires rebuilding. No environment variable is changed by this PR.

## Endpoints

| Method | Path | Input | Successful response |
| --- | --- | --- | --- |
| GET | `/api/customer-admin/support/requests` | list query | 200 customer list |
| POST | `/api/customer-admin/support/requests` | create body | 201 `{request}` |
| GET | `/api/customer-admin/support/requests/[id]` | activity query | 200 customer detail |
| GET | `/api/admin/support/requests` | list query | 200 internal list |
| GET | `/api/admin/support/requests/[id]` | activity query | 200 internal detail |
| PATCH | `/api/admin/support/requests/[id]/status` | status body | 200 `{request}` |
| POST | `/api/admin/support/requests/[id]/comments` | message body | 201 `{request}` |
| POST | `/api/admin/support/requests/[id]/notes` | message body | 201 `{request}` |

Every response from these handlers, including errors, has `Cache-Control: private, no-store, max-age=0` and `X-Content-Type-Options: nosniff`. Only the documented methods are supported; framework-generated OPTIONS/405 responses contain no support data.

All mutation bodies must be JSON. Origin must pass the existing same-origin helper; in Production it must be HTTPS and match Host. Missing Origin is rejected. Unknown body/query keys and duplicate query keys are rejected. IDs must be UUIDs. No caller-controlled requester, actor, owner or credential fields are accepted.

### Inputs

- List: `page` integer text 1..99999 (default 1), `page_size` 1..50 (default 20), optional `status`.
- Detail: `page`, `page_size` with the same bounds; independently paginates each activity array using the same page. Totals indicate whether later pages exist.
- Create: `{title, description, priority?}`. Title 1..200, description 1..10000 characters after trimming. Priority `low|normal|high`, default `normal`. Server sets `requester_admin_id` from the valid session, initial status `received`, version 1.
- Status: `{status, reason, version}`. Reason 1..2000 characters. Version integer 1..2147483646.
- Message: `{body, version}`. Body 1..10000 characters, same version bounds.
- Text is plain text, not HTML or Markdown. Disallowed control characters are rejected. JSON body byte limits: create/message 49152; status 16384. Future UI must render text nodes, never `dangerouslySetInnerHTML`.

### Responses

Customer request fields: `id`, integer `request_number`, `title`, `description`, `status`, `priority`, `version`, `created_at`, `updated_at`, nullable `closed_at`.

Customer list: `{requests, total, page, page_size}`. Only requests owned by the authenticated Customer Admin are returned. Customer detail: `{request, comments, comments_total, page, page_size}`. Comments contain only `id, author_type, body, created_at`. Nonexistent and another admin's request return the same 404.

Internal requests additionally include `requester_admin_id`. Internal detail additionally includes `notes, notes_total, history, history_total, audit, audit_total`. History carries previous/new status, reason, actor type, changed_by and timestamp. Notes carry body and actor_id. Audit carries action and actor identity, never cookies or passwords.

Lists and activity arrays are ordered by `(created_at DESC, id DESC)`. Offset pagination can shift when new records arrive; clients should refresh the first page after mutations.

Customer DTOs are allowlists at both SQL and HTTP boundaries. Internal notes, audit, internal actor fingerprints and requester identifiers never appear in customer responses.

## Status transitions

| Status / label | Allowed next states |
| --- | --- |
| received / 접수 | reviewing, on_hold, cancelled |
| reviewing / 검토 중 | in_progress, waiting_customer, on_hold, cancelled |
| in_progress / 진행 중 | waiting_customer, completed, on_hold, cancelled |
| waiting_customer / 고객 확인 대기 | in_progress, completed, on_hold, cancelled |
| completed / 완료 | reviewing |
| on_hold / 보류 | reviewing, in_progress, cancelled |
| cancelled / 취소 | none |

Self-transitions and jumps not in the table fail with 400. Completion/cancellation sets `closed_at`; reopening completion clears it. Status, public reply and internal note mutations all require the current version and increment it. A stale version returns 409; reload detail before retrying. Status, history and audit writes commit or roll back together. Request creation also records the initial received status and audit event.

## Errors

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | INVALID_INPUT | Invalid JSON/schema/query/transition |
| 401 | UNAUTHORIZED | Missing, invalid, expired, revoked or credential-invalidated session |
| 403 | UNAUTHORIZED | Only another authentication kind was supplied |
| 403 | INVALID_ORIGIN | Mutation origin rejected |
| 404 | NOT_FOUND | Missing or inaccessible request |
| 409 | VERSION_CONFLICT | Stale mutation version |
| 503 | SUPPORT_DISABLED | Valid caller, feature disabled |
| 503 | SUPPORT_UNAVAILABLE | Missing configuration, database or upstream response failure |

No database messages, hashes, keys, passwords or tokens are reflected in errors.

## Trust boundary and later expansion

`public.customer_support_rpc` and `public.admin_support_rpc` are executable only by `service_role`; implementation functions and tables are in private `support`. All functions are SECURITY INVOKER with empty search_path; all tables have FORCE RLS and no anon/authenticated privileges. The support schema must not be added to exposed API schemas.

Customer RPC revalidates and share-locks the active admin and unexpired, unrevoked session with matching credential/principal versions. It scopes reads to the derived admin ID. Changing the Customer Admin's credential version invalidates support access; rotating the ordinary employees' shared password is a different credential and is not an admin-password change.

The internal RPC validates its database caller is service_role and requires a server-derived session fingerprint. It does not independently verify the HMAC cookie: that check stays in the existing server auth helper. Service Role is a trusted, privileged backend boundary and bypasses RLS. Possession of that key is not a customer permission. Internal actor_id is a SHA-256 session fingerprint, not a named operator, reflecting the existing shared Internal Admin authentication. This phase does not change that authentication policy.

There is no organization sharing in Phase 1. Requests belong to a stable Customer Admin UUID; replacing the account does not transfer ownership automatically. Future tenants require a new tenant table, explicit admin mapping, approved backfill of every request, NOT NULL tenant_id and revised RPC predicates before multiple tenants are enabled. Do not infer tenant ownership from employee numbers.
