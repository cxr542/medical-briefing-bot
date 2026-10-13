# General user auth rollout — prepared, not released

Target: cxr542/medical-briefing-bot; baseline main 3d7e3162abbd9f4cf4f2d6717cc4ef755237d313.
Production changes are forbidden until every gate passes. No blanket db push, history repair,
old replay, running migration, workflow/schedule/Collector/internal-auth change is included.

## Binding and preflight evidence

Production alias medical-briefing-bot.vercel.app resolves to deployment
`dpl_8X4Jgy2NPvqpHYD1BodCa3ax7uJ7`, built from baseline main.
Actual deployed chunk `/_next/static/immutable/chunks/3ufe1e9mqrz0c.js` contains the URL
`https://kkcvglldsoxglfjqnsga.supabase.co`. Both deployed server and browser Supabase clients
use the same Next.js compiled NEXT_PUBLIC_SUPABASE_URL. Supabase project URL independently
matches project ref `kkcvglldsoxglfjqnsga` (healthcare-Briefing). Binding CONFIRMED on that
basis; no decrypted service credential was fetched or printed. Recheck deployment before rollout.

Read-only catalog preflight: public articles/collector_runs/collector_alert_state exist and
have RLS. customer_auth and running schemas absent. Articles public SELECT true policy and
legacy anon/authenticated ALL grants remain in Production. Collector table service grants remain.
Actual migration versions: 20260928064906, 20260929063328, 20261007041102, 20261012043225.
Repository filenames differ for historical migrations. Preserve history; apply only selected
new versions in manifest. Foundation uses CREATE SCHEMA and is intentionally not replayable.
Collision => STOP. Never reinterpret historical filename mismatches as permission to repair.

## Application behavior

/login uses existing customer-auth login API, opaque HttpOnly session, generic credential failure.
Return path allowlist is `/` or `/neurology-dashboard`. Both server pages validate user sessions
before reading/rendering protected data. Proxy matches exactly those pages, sets private/no-store
headers, and helps redirects; cookie presence alone grants no server/API authorization.
ArticleList uses same-origin /api/articles. Server validates the session live, uses server-only
service credentials, excludes DELETED, caps 500 rows, preserves KST/date/search/medical press
filters. Source filtering and pagination remain client-side. Server projects a field allowlist;
no hashes, digests or credentials are serialized. Search values use escaped quoted PostgREST literals.
Collection status requires the same general-user authorization. APIs return JSON 401, never HTML
login redirect. Expired/disabled/rotated sessions fail on the next request. Customer admin and
internal admin cookies confer no general-user authorization. Collector dispatch is outside matcher.

CUSTOMER_AUTH_ENFORCEMENT_ENABLED defaults secure. Only explicit `false` permits the temporary
public staging/rollback state. CUSTOMER_AUTH_FOUNDATION_ENABLED=true and a server-only
CUSTOMER_AUTH_RATE_LIMIT_SECRET (>=32 bytes) are prerequisites for login. No secrets use NEXT_PUBLIC.
A missing/broken auth store cannot grant access. User logout revokes DB session and clears cookie;
hard navigation plus no-store and browser restore revalidation prevent fresh protected server reads.
Already seen/downloaded data cannot be erased by server-side revocation.

## Exact rollout sequence and gates

1. Recheck main/open PR/diff, exact Production binding and catalogs; save policy/grant snapshots.
2. Complete isolated QA, CI, security review and Preview QA. Preview must use isolated DB and
   synthetic credentials, never Production bootstrap. Preview UNKNOWN => no merge.
3. Confirm operator/password input available and administrator ID/real user list supplied.
   User supplied admin ID `admin`, initial employee `1004`. Passwords have not been supplied.
4. With all gates PASS, stage explicit enforcement=false in Production and merge/deploy code.
   This stage remains public and is NOT an authentication rollout success.
5. Apply only manifest foundation then management migrations as distinct transactions via an
   exact-target migration operation. Record only their own versions. No blanket CLI db push.
6. Run operator-only bootstrap script; verify counts/IDs and Argon2id format without printing hashes.
7. Set foundation=true, enforcement=true and private rate-limit secret; redeploy. Verify registered
   login, admin UI, article API and both pages BEFORE changing articles grants.
8. Only then apply late article lockdown migration; it rejects unexpected article policies and
   missing service writer permissions. Repeat anon/authenticated SQL and actual REST token denial,
   user server reads and Collector credential checks. Verify public service usage is authenticated.
9. Production QA and next natural Collector run. No manual dispatch.

## Collector credential evidence

Read-only Supabase edge logs 2026-10-13 06:07–06:25 UTC show 656 successful Linux
supabase-py/2.32.0 article writes (PATCH200, POST200/201) and collector_runs POST201.
Boolean checks of key metadata identify both API and authorization credentials as sb_secret_
server key type; no key/prefix value/hash was output. Modern secret keys map to service_role,
bypass RLS; this is not a JWT role inference. Main workflow supplies SUPABASE_KEY to the
existing collector client. Preserve service_role grants and verify the next natural workflow.
Post-rollout natural run: PENDING (rollout has not occurred).

## Secure bootstrap

`scripts/bootstrap-customer-auth.mjs` is never called by CI/deploy. Operator configures target-bound
PGHOST/PGUSER/PGPASSWORD through a secure local terminal/provider, with PGSSLMODE verify-full
and trusted PGSSLROOTCERT; no passwords in command arguments, history, PR or chat.
Set CUSTOMER_AUTH_BOOTSTRAP_PROJECT to confirmed ref. Execute Node in an operator TTY after all
migration gates PASS. It prompts hidden, confirmed, distinct administrator/shared passwords,
hashes locally with pinned Argon2id, and sends SQL through stdin, never stdout/stderr.
A single transaction locks auth principal tables, refuses any existing principals, then creates
only admin/admin credential, shared credential and employee1004. A repeat refuses to overwrite.
Database infrastructure may log failed SQL; keep database statement logging disabled for bootstrap,
restrict audit access, and treat hashes as sensitive. The script suppresses error statements locally.
No Production synthetic users are created. Current state: CREDENTIAL INPUT REQUIRED.

## Rollback (prepared before Production changes)

- If auth is broken, retain enforcement and show unavailable while fixing when possible.
- Emergency fallback: operator explicitly chooses temporary public access by enforcement=false,
  redeploying this version; no browser anon reads are reintroduced. Server article path still works
  with service_role even after lockdown. This is an access-policy regression and must be reported.
- Code rollback to baseline requires a separately reviewed restoration of the captured SELECT policy
  and SELECT grants before old browser queries can work. Never restore ALL/TRUNCATE unnecessarily.
  Do not restore public article access merely to fix an authentication failure.
- Revoke sessions when credentials are compromised; credential rotation invalidates user sessions;
  admin sessions remain separate. Rollback never revives revoked tokens.
- Preserve private customer_auth schema/data/history; destructive drop is not an operational rollback.
  Prefer forward fixes. Keep Collector writer privileges untouched. Restore only captured and reviewed
  article grants/policies when required; do not change running/collector tables or schedules.

## Current release decision

Production migration/bootstrap/env activation/lockdown NOT PERFORMED.
Preview QA, final CI/security review and actual passwords remain required.
PRODUCTION ROLLOUT: BLOCKED. NOT READY FOR CUSTOMER USE.
