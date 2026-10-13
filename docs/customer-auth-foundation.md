# Customer Auth / DB Foundation

## Scope and baseline

Baseline: remote main `02e5e5b243f15b1ae91332b2bdb1742e0af763f7` (PR #80 merged).
Feature: `feat/customer-auth-foundation`. Existing medical UI, `/admin`, Collector, workflows,
article queries and public policies are unchanged. `/customer-admin` remains explicitly mock-only.

**Production migration: NOT APPLIED. Production credential/bootstrap/rollout: NOT DONE.**
This is a disabled foundation, not a claim that medical data is now private.

## Confirmed current architecture and unresolved binding

Internal Admin uses server `ADMIN_PASSWORD` verification and an eight-hour HMAC cookie,
HttpOnly/SameSite=Lax/Secure in production. Monitoring verifies it before service-role DB reads.
Logout clears the cookie; copied stateless tokens remain valid until expiry/credential rotation.
There is no global proxy/middleware auth. Initial articles use an anon client on the server,
and ArticleList uses the browser anon client directly. Public collection-status is a server read.

Read-only catalog inspection of healthcare-Briefing (`kkcvglldsoxglfjqnsga`) found public
articles/collector_runs/collector_alert_state with RLS. Articles still have public SELECT true.
Neither running nor customer_auth exists there. Current history versions are
20260928064906, 20260929063328, 20261007041102, 20261012043225; these differ from
repository migration filenames. No DB application/link/repair was performed.
The production Vercel alias reports the baseline main SHA. Its actual DB environment binding
is **UNKNOWN**, so the inspected project's catalogs must not be presented as a confirmed
production connection. Latest open PRs #54/#55 concern Collector; #38 concerns release notes.
Running core v1 (PR #53) is already in main but its deployment remains separate.

## Architecture and trust boundary

Browser -> separate user/admin login handler -> durable admission -> Argon2id verification
-> atomic SQL principal/version recheck -> random opaque cookie -> live DB session validation.

`CustomerAuthService` depends on an `AuthRepository`; the server-only adapter calls one
allowlisted, SECURITY INVOKER `public.customer_auth_rpc` bridge. All six data tables are in
`customer_auth`; this schema does not need Data API exposure. PUBLIC/anon/authenticated
have no schema/table/function rights, including no bridge EXECUTE. service_role has explicit
USAGE, selected read/insert/update rights and invoker EXECUTE. Audit UPDATE/DELETE and
all auth-table DELETE/TRUNCATE permissions are omitted. RLS is enabled on all tables.
Service-role bypasses RLS; ACLs and server authorization remain essential.
No SECURITY DEFINER function, dynamic SQL, password validation in the browser, or service
key in responses is introduced. Existing articles/collector/running privileges are untouched.

**Shared-project limitation:** the existing service-role credential is privileged across this
foundation. Any other service holding the same role/key is within this trust boundary;
private schema is not isolation from that credential. A dedicated server DB role/connection
is a future hardening option. Do not give service-role keys to customer administrators.

## Schema

- customer_users: UUID identity, unique string employee_number, active, session_version,
  timestamps/disabled_at. No six-digit constraint; 1..64 non-whitespace characters, leading
  zero preserved. Hard deletion is not a management operation.
- customer_credentials: one shared credential plus future per-user credential slots;
  password_hash, credential_version, updated_at/by. Individual login is not implemented.
- customer_admins: multiple separate personal credentials; primary/backup/manager/deputy
  designation, active and credential/session versions. Designation is a future workflow
  label; all active customer admins currently have the same customer management authority.
- customer_sessions: hashed random token, mutually exclusive user/admin FKs, credential
  and principal versions, issued/expires/revoked times. Indexed by principal and expiry.
- customer_audit_logs: actor/action/target/time. Metadata restricted to empty object for
  now; no password/hash/token/IP/User-Agent/attempted unknown employee identifier recorded.
- customer_login_limits: keyed HMAC IP and IP+identifier windows, atomic counters/expiry.

Stable user UUID survives employee number changes. Future individual credentials and
external identity links can attach to it; never delete shared auth.users to disable medical
membership in a multi-app project. SSO/OIDC/SAML/MFA providers are follow-up work.

## Password and session security

Pinned `@node-rs/argon2@2.2.2`, Argon2id, m=19456 KiB, t=2, p=1, random 16-byte salt,
32-byte output. OWASP minimum profile; tune only after target-runtime concurrency testing.
The helper accepts this bounded PHC profile and rejects corrupt/unbounded-cost hashes.
Password creation length: 12 characters minimum, 512 UTF-8 bytes maximum. Input is not
normalized. Login may submit shorter strings, which simply fail against initialized credentials.
There is no plaintext credential storage, log or response. Failed/unknown/inactive logins use
the same response and expensive verifier path; a process-local dummy hash is only timing
padding, never an account credential. Exact constant-time HTTP behavior is not guaranteed.

Tokens are 32 random bytes; DB stores SHA-256 digests, not raw tokens. User TTL 8h, admin
TTL 1h, absolute/no sliding renewal. Production cookies have __Host- prefix, Secure,
HttpOnly, SameSite=Lax, Path=/, no Domain. Development uses separate non-prefixed names.
Cookie names/principal kinds are distinct from internal Admin. Duplicate/malformed cookies
are rejected. Auth responses are no-store. POST requires same Origin and limited JSON body.

Password rotation changes hash/version and writes audit in one RPC transaction. Disabled
or reactivated users increment session_version via trigger. Existing session validation joins
current credential/principal state every request, with no cross-request auth cache. Login
issuance locks/rechecks versions after hashing; it cannot silently acquire the new version
from a concurrent rotation. Admin credential/active changes likewise invalidate admin sessions.
Logout revokes the DB token before clearing the cookie. DB failure returns 503 (fail closed).
"Immediate" means requests validated after transaction commit; already displayed data or
in-flight requests cannot be recalled.

Mutation helpers re-authorize administrators in SQL and write audit atomically. add_user,
set_user_active and rotate_shared RPC operations are foundation primitives; no management
HTTP endpoints/UI wiring or credential bootstrap endpoint is exposed yet.

## API and activation guard

Implemented Node routes:

- POST /api/customer-auth/login, /logout; GET /api/customer-auth/session.
- POST /api/customer-admin/login, /logout; GET /api/customer-admin/session.
- Login JSON: identifier, password. Response only ok/principal (never hash/credential).
- Missing session: 401; other customer role cookie: 403; invalid token: 401.
- Foundation disabled/unavailable: 503. Anonymous logout can clear stale cookies.

Default: `CUSTOMER_AUTH_FOUNDATION_ENABLED` must equal `true` before any adapter use.
Login additionally needs a server-only `CUSTOMER_AUTH_RATE_LIMIT_SECRET` >=32 bytes to
HMAC rate identifiers. Neither variable was configured in Production or Preview.
Existing server Supabase URL/service-role settings are reused only when explicitly enabled.
No environment pull, credential read, initialization or real employee registration was done.
A Preview with shared production DB must never enable this flag.

## Rate limit / audit status

IMPLEMENTED: atomic DB counters shared across serverless instances, IP <=100 attempts and
IP+identifier <=5 attempts per 15-minute fixed window. All attempts reserve quota before
hashing, not only failures; responses use 429 and conservative Retry-After=900. Kind is part
of the HMAC key, so customer user/admin budgets are distinct. Only platform-set
x-vercel-forwarded-for is considered; invalid/missing IP goes into a conservative shared
unknown bucket. Check deployed header guarantees/NAT behavior before rollout.

IMPLEMENTED: employee added/activated/disabled, shared password changed, admin login and
failed admin credential verification audit. Rate-limited requests are represented by counters,
not an unlimited per-attempt audit stream. No customer user failed-login identity log.
FOLLOW-UP: global abuse/concurrency cap, WAF before DB/hashing, sliding lockout if needed,
admin audit browsing/alerting, session/rate/audit retention/cleanup, pricing and NAT tuning.
Fixed windows allow a boundary burst and are not a guaranteed full fifteen-minute cooldown.
In-memory counters would not be sufficient; no memory limiter is used.

## Verification (isolated only)

- Frontend 180 tests passed (7 new Auth cases + 173 baseline).
- Actual disposable PostgreSQL migration/RPC integration: 6 passed. Test process requires
  an explicitly named network-none, unprivileged postgres container with an empty public
  schema. Real Argon2 hashing, service-role ACL, session invalidation, audit and durable
  counter persistence verified. This is PostgreSQL integration, not a live PostgREST test.
- Foundation-disabled HTTP build: 4 passed (Origin/body/role/session/cookie/deep-link).
- Existing Admin local fake-DB route integration: 7 passed.
- Existing Admin/health/recovery/release tests: 48 passed.
- Existing Python Collector/parser/keyword regressions: 206 run, 205 passed, one optional
  native Kiwi smoke skipped. Missing local dependencies were installed to match CI.
- TypeScript, ESLint and webpack production build passed with fake command-local URL/key.
- Browser static bundle scan finds no auth secret names/Argon2 hash strings.
- Existing customer mock UI Chromium QA at 375/768/1440px passed: search/add/bulk/status,
  pagination/password checks, refresh reset and focus/ESC; no API/Supabase requests or page errors.
- Clean npm ci and the final production build passed with the pinned native dependency.

Reproduce core: `cd medical-briefing-bot/frontend && npm ci && npm test`.
For SQL proof create a NEW postgres:17.6 container with network none, explicit name
customer-auth-foundation-<unique-suffix>, POSTGRES_HOST_AUTH_METHOD=trust (isolated only),
then run CUSTOMER_AUTH_TEST_CONTAINER=<name> node --test supabase/tests/customer_auth.integration.mjs
from repository root. Never use a shared/linked DB. Remove only that test-owned container.
The script is intentionally one-shot and refuses a nonempty public schema.
For disabled HTTP tests start the placeholder production build on loopback and run
CUSTOMER_AUTH_TEST_ORIGIN=http://127.0.0.1:<port> node --test medical-briefing-bot/tests/test_customer_auth_http.mjs.

## Rollout, database compatibility and limitations

Method A treats employee number as an access identifier, not proof of identity. A person
knowing the shared password and another active employee number can impersonate them.
Use individual passwords/SSO for stronger identity guarantees; do not claim per-person audit
attribution for shared-password logins.

Compatibility: CONDITIONAL. Auth namespace does not modify public/running objects, but
history versions already diverge. Do NOT run blanket db push, repair/replay old migrations,
or combine the undeployed running migration casually. Prepare an approved auth-only bundle
against the actual target history, with disposable baseline/RLS/ACL verification first.

Follow-up sequence: review/merge foundation separately -> customer management API + reauth
policy -> mock UI integration -> user Login UI -> server article data authorization -> remove
browser anon article queries and public article grants/policies in a coordinated rollout ->
isolated integrated Preview QA -> separately approved target-only migration/bootstrap/secrets
-> Production rollout and natural scheduled Collector observation.

Status: helpers/API/SQL primitives IMPLEMENTED; UI/service access enforcement and provider
expansion FOUNDATION ONLY/FOLLOW-UP REQUIRED. Production operations intentionally NOT DONE.
No claim that public article access is secured, nor that this PR alone enables customer auth.
