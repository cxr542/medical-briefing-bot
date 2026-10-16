# MB-006 Phase 1 implementation report

## A. Executive Summary

DB/auth/API foundation implemented with support disabled by default. Existing Customer Admin and Internal Admin authentication are reused separately; no UI, menus, attachments, buckets, seed data or production changes are included. Local implementation and self-review passed; managed staging validation and CI results remain rollout gates.

## B. Baseline

- Main / origin/main: `225981064becc41ec4a1ee6f8dbe57dbd0ff08e8`.
- Original branch `fix/collector-schedule-offset`, HEAD `548ee2c88905b40d6831352ddfcc405d0f7f8cec`, dirty. Existing modifications and untracked files preserved.
- Implementation branch: `feat/mb-006-support-foundation`, separate worktree.
- Open PRs: #90, #55, #54, #38. No changes made to those branches.
- Auth locations: `src/lib/customer-auth/{core.mjs,server.ts,managementServer.ts}`, `src/lib/adminAuth.mjs`, `src/lib/adminSupabase.ts`.
- Production schema was inspected read-only. Existing migration history is incomplete relative to auth objects; see [migration guide](MIGRATION.md).

## C. Changed Files

- Seven new route files below `src/app/api/customer-admin/support/requests` and `src/app/api/admin/support/requests` implement eight HTTP operations.
- `src/lib/support/contract.ts`, `server.ts`: input/output schemas, audience-specific authentication, error mapping and feature gating.
- `supabase/migrations/20261016014502_support_foundation.sql`: additive private schema, five tables, RPCs, ACLs, RLS and transactional state changes.
- `supabase/rollback/support_foundation_empty_only.sql`: empty-only removal with data-loss refusal and dependency restrictions.
- `tests/supportContract.test.mjs`, `supportDatabase.test.mjs`, `support-http.mjs`, `fixtures/supportDatabase.mjs`: boundary, real database and real HTTP tests.
- `package.json`, lockfile: pinned Zod 4.6.7 and test-only PGlite 0.5.10, HTTP test command.
- `.github/workflows/support-foundation-tests.yml`: read-only, secret-free PR checks. Existing collector workflows untouched.
- `supabase/.gitignore`: ignores CLI metadata.
- This report, [API contract](API.md), [migration and rollback guide](MIGRATION.md).

## D. Authentication Integration

Customer support accepts only Customer Admin sessions, revalidating expiry, revocation, active state and credential/session versions in the server and RPC. Ordinary employee and internal cookies cannot replace it. Internal support verifies the existing HMAC Internal Admin session. General customer enforcement switches never bypass support authentication. Feature gating occurs after auth.

Internal shared-password authentication identifies only a session; audit actor_id is a server-generated session fingerprint. No personal authentication system is introduced. Internal RPC trusts an authenticated service_role backend assertion; it does not verify the HMAC cookie itself.

## E. Database Schema

Private `support`: `support_requests`, `support_comments`, `support_status_history`, `support_internal_notes`, `support_audit_events`. All five use FORCE RLS. anon/authenticated have no schema/table/RPC access. Existing auth schema is only referenced, never changed. Request ownership is the authenticated Customer Admin UUID. Future tenant isolation requires explicit mapping/backfill before use.

## F. API Contract

See [API.md](API.md) for endpoints, input limits, pagination, statuses, DTOs and errors. Creation derives the owner; public and internal responses are allowlists. All mutations require same-origin JSON and optimistic version checks. Status, history and audit writes are atomic. Activity is paginated rather than silently truncated.

## G. Security Verification

| Scenario | Result | Evidence |
| --- | --- | --- |
| Anonymous, ordinary employee, wrong admin kind | PASS | HTTP auth matrix, support-http.mjs |
| Expired/revoked/inactive/password-version-invalid session | PASS | HTTP and SQL session tests |
| Enforcement false / support disabled / auth unavailable | PASS | HTTP feature and configuration tests |
| Owner spoof and cross-admin IDOR | PASS | create schema, HTTP 400/404 and SQL ownership tests |
| Internal notes / audit / credentials in customer JSON | PASS | SQL separation, DTO stripping, HTTP sentinel tests |
| CSRF and bounded/malformed input | PASS | All mutation families reject bad Origin; input tests |
| XSS boundary | PASS for API | Plain text is returned as JSON with nosniff; no HTML rendering surface added |
| Conflicting versions | PASS | Concurrent HTTP calls return 200 and 409; one history/audit write |
| RLS / RPC ACL | PASS | Role execution tests and non-bypass role denied even after SELECT grant |
| Cache policy and generic errors | PASS | HTTP no-store/nosniff and error response assertions |
| Server secrets in client bundles | PASS | No ADMIN_PASSWORD or SUPABASE_SERVICE_ROLE_KEY names in .next/static |

Future UI XSS behavior is unverified and must use text nodes. Supabase-managed API behavior and native multi-connection scheduling are not covered by the local adapter.

## H. Test Results

Tested implementation commit: `ed224f0983af59b54c4767e2302915ef10a7b1c6`.

| Command / surface | Observed |
| --- | --- |
| `npm test` | 206/206 passed |
| `npm run test:support:http` | 10/10 passed; includes a separately executed 4/4 existing customer HTTP suite |
| `npm run build` | Passed locally, no deployment |
| `npx tsc --noEmit` | Passed |
| `npm run lint` | Passed with no lint warnings |
| `git diff --check` | Passed |

Local evidence: `/private/tmp/mb006-unit.log`, `/private/tmp/mb006-http.log`, `/private/tmp/mb006-build.log`, `/private/tmp/mb006-admin-regression.log`, `/private/tmp/mb006-node-regression.log`, `/private/tmp/mb006-collector.log`. These are local transcripts; repository CI reruns the support tests without production secrets.

## I. Migration Validation

Executed the exact migration SQL against separate PGlite PostgreSQL databases. Verified all five tables, RLS/ACLs, ownership, atomic history/audit, invalid transitions, completion/reopening/cancellation timestamps, version conflicts, reapplication refusal, injected DDL failure rollback, successful recovery, empty removal and populated removal refusal. Existing synthetic auth rows survive failure and rollback.

The test auth schema is a contract fixture, not a dump of production. This migration does not bootstrap the missing legacy migrations. No migration was applied to production Supabase.

## J. Regression Results

- Existing Internal Admin security and HTTP monitoring/status: 16/16 passed.
- Existing customer login/account HTTP suite: 4/4 passed, unchanged source, explicitly started loopback server.
- Collector/alert/release-note Node suites: 70/70 passed.
- Offline Python collector suites: 206 run, 205 passed, 1 pre-existing optional native-smoke skip.
- Existing customer auth/account management and article tests also pass in the 206-test frontend suite.

## K. Risks

1. Existing migration-history drift prevents treating this as a complete blank DB migration chain. Reconcile before managed rollout.
2. PGlite serializes connections; managed PostgREST and native PostgreSQL concurrent locking need staging validation before activation.
3. Existing shared Internal Admin login has no per-person attribution or per-session central revocation. This phase intentionally preserves it.
4. `npm audit` reports 1 critical and 9 high vulnerabilities in existing Next.js/build dependencies. All ten affected package versions are unchanged from main; new Zod/PGlite are not listed. Do not treat this PR as a dependency-security remediation or a production approval.
5. No deletion/retention worker, upload subsystem, organization sharing or seed data is included.

## L. PR

Submitted from `feat/mb-006-support-foundation` to `main`; the chat handoff contains the created PR URL. No merge or production deployment is performed.

## M. Merge Recommendation

Ready for code review with support disabled. Require PR checks and normal human review before merge. Production migration/activation remains a separate approval after migration-history preflight and managed staging verification. Keep SUPPORT_ENABLED false throughout this phase.

Self-review: PASS for the requested local implementation scope, using a dedicated detached review worktree at the tested commit. No blocker found in auth separation, ownership, DTO isolation, state transaction or prohibited-change checks. This is a main-session review, not an independent subagent approval.

## N. Usage Snapshot

Available snapshot: weekly used 8%, remaining 92%, reset 2026-10-22 19:33:42 KST; reset credits 3. Tokens, context usage/remaining and five-hour window are unavailable. Credits were not used. Final handoff supplies the credit grant/expiry dates.
