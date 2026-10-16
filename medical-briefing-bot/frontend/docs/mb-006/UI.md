# MB-006 Phase 2: support UI

Baseline: main `08b0bc4f58ecdbfc74b974bb31b918c8e7ed9f94`, after PR #91.

## Screens

- `/customer-admin` keeps account management and adds account/support navigation.
- `/customer-admin/support` provides the owned request list, status filter,
  pagination, new-request dialog, detail and read-only public answers.
- `/admin` keeps monitoring/release views and adds a support link.
- `/admin/support` provides the full request list and detail, public replies,
  private notes, status changes with reasons, processing and audit history.

Both new pages authenticate on the server using the existing separate sessions.
Ordinary employee authentication never grants access. Server-rendered pages are
dynamic and noindex. No new credential or client-side Supabase connection exists.

## API contract and state

The UI uses the Phase 1 same-origin support APIs and existing Zod response/input
schemas. It sends no owner, actor or service-role credential from the browser.
Customer DTO parsing and rendering exclude notes/audit/internal actor fields.
Submitted text is React text, never injected HTML. Fetch is same-origin/no-store.
The database remains the authority for allowed status transitions; the frontend
does not duplicate the transition matrix or modify the API contract.

Lists use page_size 10. The detail API uses one page for its separate feeds;
internal pagination covers the maximum of comments/notes/history/audit totals.
400/401/403/404/409/503 and network/invalid-response failures have safe notices.
401 offers the existing login. A conflict reloads current data, keeps drafts and
requires acknowledgement before a new save. A successful save followed by a
failed refresh is announced as saved; retry performs GET only. Pending writes
disable actions and a ref blocks immediate duplicate submissions.

`SUPPORT_ENABLED` is checked on the server, defaults off, and is not a public
environment variable. Disabled pages show an explicit preparation notice without
fetching support data or showing registration/management controls. Existing
account management remains available. The existing APIs still independently
authenticate and enforce the feature flag, including when general customer
enforcement is false. Editing client state cannot enable an API.

## Local mock and regression testing

```sh
npm ci
npx playwright install chromium
npm test
npm run test:support:http
npm run test:support:ui
npx tsc --noEmit
npm run lint
```

Run HTTP and UI suites sequentially: each owns a production build. UI tests own
loopback ports 3027/3028; the runner refuses to reuse an existing server. Their
fixture creates only a synthetic session-validation adapter and starts local Next
processes with process-scoped dummy settings. It rejects every other database
RPC. Playwright intercepts support/account APIs with tests-only data; no support
write reaches Supabase. None of these mocks is imported by application code.

15 browser tests cover customer list/filter/pagination/detail/create, escaped
text, internal reply/note/status, rejected transition, conflict acknowledgement,
400/401/403/404/503, disabled UI, separate auth, mobile/tablet overflow, dialog
focus/Escape restoration, in-flight double submission, account navigation and
saved-but-refresh-failed recovery. The existing 206 unit/DB and 10 support HTTP
plus 4 customer HTTP tests are retained. A prior history test assumed distinct
timestamps; it now verifies all eight transitions/reasons and the cancellation
predecessor without assuming ordering within equal timestamps.

PR CI runs browser installation and UI tests after the existing foundation
checks, using no production secrets. Screenshots/traces on failure are ignored
local test artifacts, not application assets.

## Rollout and limitations

This phase does not apply a migration, repair history, enable support, alter
Secrets or production settings, execute Collector, create support data, or merge
a PR. New pages can be deployed disabled; users see a preparation notice.
Before activation, complete the separately approved migration baseline/preflight,
backup and target checks, managed Supabase/PostgREST role/error/ownership tests,
native concurrent support RPC acceptance, and actual user-flow staging review.
UI mocks are not managed database acceptance. See [migration plan](MIGRATION.md).

Attachments, buckets, initial MB-001..005 data, customer-written replies, tenant
mapping and individual internal-operator accounts are not implemented. Existing
inherited dependency advisories are not remediated by this UI change. Current
customer/internal workspaces remain light in both OS themes. Browser emulation
does not replace physical-device or assistive-technology user testing.
