# Support request #5 — ID usage (implementation awaiting review)

## Contract

- Keep registered ID + shared password authentication. This counts IDs, not people.
- Successful user session insertion counts one login, and one KST access day.
  Rejected credentials and admin sessions do not count. Session issuance and the
  aggregate increment share a transaction; retrying the same session insertion
  cannot count it twice.
- Visible-page session POST renews the existing session and updates the daily
  activity row atomically. GET/hidden checks, article API reads and administrator
  report reads never record usage. Visible idle pages count as active; this is
  presence, not reading time. Normal update resolution is about one minute.
- One primary key per user/KST date prevents duplicate access days from tabs,
  refreshes and repeated checks. Actual successful re-logins count separately.
- Recent access uses the latest record across all dates. Access days/logins and
  period breakdowns use the inclusive selected date range. Week starts Monday.
  Sparse breakdowns omit periods without activity; partial weeks/months include
  only selected dates. No historical reconstruction/backfill is attempted.
- Two private tables: daily aggregates plus one immutable collection-start row.
  The latter distinguishes unmeasured history from measured zero. No IP,
  password, cookie or token digest is stored in the usage tables.
- `/customer-admin/usage` and GET `/api/customer-admin/usage` require the existing
  customer-admin session. SQL revalidates it. Internal-admin and general-user
  cookies cannot read it. Explicit grants + RLS keep public roles out.
- Search is literal partial ID matching; 20 users/page; up to 366 inclusive days.
  Inactive/unused IDs remain visible. No retention deletion job is introduced.

## Before any production operation

User approval remains required for commits, PR creation, DB changes and deployment.
No production operation has been performed. Do not blanket `db push` or replay
historical migrations. Identify the correct application DB and deployed commit,
review migration history/grants and backup procedure separately.

Approved rollout order:
1. Apply only root `supabase/migrations/20261030010818_customer_usage.sql` after
   verifying its existing customer-auth and remember-login prerequisites.
2. Verify server-only grants and existing login functionality. The new insertion
   trigger starts login collection immediately, including on the old frontend.
3. Deploy the new frontend, then verify ordinary/remembered visible activity,
   user-denied report reads and administrator date/search/pagination in production.
   Full visit coverage begins at step 3; collection-start is step 1, so the rollout
   interval can contain login-only observations. Document the rollout interval.
4. Leave support request #5 unchanged until deployment acceptance is complete.

Rollback: deploy the old frontend first. It uses the unchanged existing session
RPC; the tables and login trigger are backward compatible and may be retained.
Do not delete aggregates, disable the trigger or drop RPCs/tables automatically.
If collection must stop, obtain separate approval for that DB operation.
If the new frontend precedes the migration, visible session refresh fails closed;
therefore the migration-before-frontend order is required.

## Local verification

From `medical-briefing-bot/frontend`:

```sh
npm ci --ignore-scripts
npm run build -- --webpack
npm test
node --experimental-strip-types --test tests/customer-usage-http.mjs tests/remember-login-http.mjs
npx tsc --noEmit
```

Build without a NEXT_PUBLIC_SUPABASE_URL value for runtime-configured local HTTP
fixtures: Next inlines a build-time value. The HTTP fixture uses isolated PGlite,
synthetic credentials, ephemeral ports and the actual production Next routes.
It is a local RPC wire fixture, not hosted Supabase/PostgREST verification.
The optional localhost browser proxy rewrites local HTTP Origin to the upstream
HTTPS Origin expected by production auth; production application code and its
Origin checks are unchanged. Browser tests do not verify real TLS transport.
