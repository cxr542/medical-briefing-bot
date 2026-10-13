# Customer Admin API + UI Integration

## Baseline and stop point

Latest fetched main: `77c48d277e37e12082c2361e1fd5e0b8130f2551` (PR #80 and #81 merged),
clean starting tree, branch feat/customer-admin-integration. No subsequent baseline changes.
Open PRs #54/#55 are Collector work and #38 is release-note content; no overlapping auth change
was observed. Foundation source/SQL security contracts are retained. The only shared helper
change exports its bounded JSON reader with a default 4096-byte limit; management uses 16384.

**Production DB/credentials/Secret/env/flag changes: NONE. Production migrations: NOT APPLIED.**
No actual customer administrator/employee/password was created. No Collector/manual Actions,
main push, merge or Production deployment is part of this work.

## Architecture / API

/customer-admin server page -> live admin session validation -> CustomerAdmin client
-> same-origin management API -> CustomerAdminManagement / AuthRepository boundary
-> service-role-only management RPC -> customer_auth.

The page uses async Next headers and redirects to /customer-admin/login before returning
any management UI when authorization is absent/invalid/unavailable. No global middleware/proxy
is added, so medical pages and Collector dispatch are untouched. Client redirects supplement
API authentication; they are not the security boundary.

| Route | Method | Contract |
|---|---|---|
| /customer-admin/login | GET | Dedicated customer-admin ID/password form, safe next |
| /customer-admin | GET | Server admin check; unauthorized -> login |
| /api/customer-admin/login, /session, /logout | existing POST/GET/POST | Foundation authentication, absolute 1h TTL |
| /api/customer-admin/users | GET | search/status/page/page_size; users + total + overall stats + public admin/credential metadata |
| /api/customer-admin/users | POST | employee_number string; 201 created; duplicate 409 |
| /api/customer-admin/users/bulk | POST | employee_numbers array or comma/newline text; 1..100, atomic |
| /api/customer-admin/users/[id]/status | PATCH | UUID id, boolean active; no hard delete |
| /api/customer-admin/shared-password | POST | password, confirmation, admin_password; fresh password confirmation required |
| /api/customer-admin/audit | GET | page/page_size/action, whitelisted event DTO |

401: no/invalid/expired customer-admin session. 403: customer-user/internal-admin cookie without
customer-admin cookie, wrong Origin or rejected administrator password confirmation. Existing
internal Admin rejects customer cookies as 401 because they are not internal credentials.
400: input/query/body validation; 404: unknown target; 409: duplicate; 429: reauth/login quota;
503: disabled/unavailable store or network. Errors never forward DB diagnostics. Responses no-store.

## User / bulk policy

Employee numbers are trimmed strings, 1..64 characters, no whitespace/control characters;
no six-digit/number-only rule. Leading zeros preserved. Browser preview lists all parsed IDs.
Blank lines/delimiters are ignored, duplicate entries are rejected, and existing duplicate rows
produce 409. Maximum 100 per request, body cap 16KiB. One RPC transaction adds all rows and
per-user audit records or rolls everything back; no partial created/skipped behavior.

Search uses literal PostgreSQL position(search IN employee_number), not LIKE/OR/raw filters.
% and _ have no wildcard meaning. Status allowlist all/active/inactive. Page 1..100000, size 1..50
(default 10). Order created_at DESC,id DESC. Stats are computed on the server over all users,
not the paginated browser array. UI status filter/search resets page; pages are server-backed.
No hard delete route/operation or default permission is introduced.

## Credential and authorization security

Pinned Argon2id, random opaque session, digest-only DB storage, HttpOnly/Secure/__Host- cookie,
SameSite=Lax, live version checks, generic login failures, DB attempt counters and server-only
service-role access are unchanged. Login uses a dedicated customer-admin credential.

Every management handler validates the admin session before data access; the service boundary
revalidates it, and the SQL management RPC locks/revalidates the principal/session in the same
transaction as reads or mutations. Each new RPC is SECURITY INVOKER with empty search_path;
PUBLIC/anon/authenticated EXECUTE is revoked. No Data API exposure of customer_auth tables
is needed. The original #81 migration is unchanged; the new additive migration requires it.

Shared password change requires the current administrator password on every submit.
Confirmation attempts use the existing durable IP/identity admission counters with a distinct
reauth identity. Incorrect confirmation returns 403 and a failed-admin event, quota exhaustion
429. Password hashing happens server-side. SQL compares the verified admin credential_version
under lock before calling the Foundation rotation primitive, preventing stale reauth after an
administrator credential change. Client clears password fields on response; never logs/stores
passwords in browser storage, audit, response or URL. No current password/hash is displayed.

Rotation increments shared credential_version and logs the change atomically. All prior general
user sessions fail the next protected request; admin sessions stay valid. active changes use
Foundation's session_version trigger; reactivation cannot revive old sessions. Logout revokes
before clearing the cookie; copied revoked tokens remain invalid. No indefinite renewal is added.
UI checks on focus and once per minute and redirects on 401; server requests always validate
independently. Already displayed content/in-flight approved responses cannot be recalled.

Management public DTOs explicitly project approved fields: users contain only id/employee_number/
active/created_at/updated_at/disabled_at. Admin header uses login_id from the DB; credential card
contains configured/updated_at only. Audit contains id/action/occurred_at/actor/target. No hash,
version, session digest, rate HMAC, internal auth metadata or service key is exposed.

## Audit / UI

Existing action vocabulary: employee_added/activated/disabled, shared_password_changed,
admin_login, failed_admin_login. Reads show latest six, full history uses server pagination,
password history filters shared_password_changed. Actor is login_id or system for unauthenticated
failures; no attempted unknown login ID/password/IP/User-Agent is added to audit. Historical
actor/target names are current joined identifiers, not immutable identity snapshots.

Approved blue/light design retained: broad user panel + password/history sidebar, mobile user
cards and stacked sections. Runtime mock fixtures and local-only mutations are removed from
live page components. Existing fixture utility remains only for its earlier unit tests, not UI.
Search is debounced with stale requests aborted. Loading/error/empty/retry and 401/403/409/429/
503 messaging are handled. Dialogs retain native focus, explicit Tab loop, ESC and focus restore;
mutations disable duplicate submit and keep the dialog/error visible on failure. During an active
submit, closing is deferred until the response to avoid losing pending-operation context.
Dates render Asia/Seoul. Long employee IDs wrap instead of forcing mobile/table overflow.

## Authorization matrix

| Actor | Customer management | Internal Monitoring | Collector dispatch | Main medical articles |
|---|---|---|---|---|
| Anonymous | login only; API 401 | 401 | Bearer required | unchanged/open |
| General customer user | 403 | 401 | Bearer required | unchanged/open |
| Customer admin | own management | 401 with only customer cookie | Bearer required | unchanged/open |
| Internal admin | 403 with only internal cookie | existing separate auth | Bearer required | unchanged/open |
| Collector service | not automatically an admin | not automatically an admin | existing CRON_SECRET | existing service DB access |

Shared service-role backend credentials remain a privileged trust boundary; schema separation
is not isolation from another backend holding the same key. A dedicated server role and WAF/
global abuse/concurrency/retention policies remain future hardening. Method A still permits
impersonation when another active employee ID and shared password are known.

## Verification / reproduction

Frontend 183 tests passed (includes management validation/DTO projection/open redirect tests).
Real network-none PostgreSQL 17.6 + local PostgREST-compatible fixture transport + actual Next
handlers and Chromium integrated validation passed all seven scenario groups. This is real SQL
and browser/API execution, but uses a fixture transport rather than deployed Supabase PostgREST.
It verifies anonymous/wrong roles, page guard, list/search/pagination/stats, duplicate/invalid/bulk
rollback, status/revoke/reactivate, fresh reauth/shared rotation/audit, expiry/tamper/logout/copied
tokens and cooldown. Browser covers 375/768/1440, login/search/add/bulk/status/password/audit/
refresh/pagination/logout and dialog keyboard. All identities/keys/passwords are synthetic.

Run in a NEW network-none unprivileged postgres:17.6 container named
customer-auth-foundation-<unique-suffix>, isolated trust-only authentication, then from repo root:
CUSTOMER_AUTH_TEST_CONTAINER=<name> node --test supabase/tests/customer_admin.integration.mjs
Optional browser: set CUSTOMER_ADMIN_PLAYWRIGHT_PATH to an installed Playwright index.mjs and
provide /usr/bin/chromium. No repository dependency/production environment pull is required.
The harness refuses a nonempty public schema and does not expose a DB network port.
Remove only its test-owned container after verification. Screenshot directory is local artifacts.

Existing internal Admin fake-DB HTTP 7/7 and Admin/health/recovery/release 48/48 passed.
Offline Python Collector/parser/keyword: 206 run, 205 passed, optional native Kiwi smoke skipped.
Foundation-disabled HTTP checks cover 401/403/503/Origin/body/cookie and server redirect.
TypeScript, ESLint and final webpack build pass with placeholder URL/key. No manual workflow or
Collector invocation was used. Remote Preview checks are read-only and never activate the flag
or submit credentials against an unconfirmed DB binding.

## Remaining boundaries / rollout

Public medical article access is still open.
Customer authentication is not yet enforced for the main service.

Production customer_auth/migrations/bootstrap/flag settings are not assumed ready. Do not enable
CUSTOMER_AUTH_FOUNDATION_ENABLED on Preview sharing Production. Actual Production DB binding
remains unconfirmed; history filename/version mismatch requires target-only migration preflight.
Never blanket db push/history repair/replay or casually combine undeployed running migrations.

Next: integration review/merge separately -> General User Login -> server article API -> remove
browser anon queries -> protect main/deep links -> coordinated public article lockdown -> isolated
integrated Preview -> confirm Production binding/history -> approved auth-only migration/bootstrap
and secrets -> Production rollout plus natural scheduled Collector observation.
