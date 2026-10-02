# Latest-main reconciliation and commit candidate — 2026-10-02

**READY FOR COMMIT/PR**. No commit, push, PR or Production operation was performed.

## A. Latest Main State

Medical remote/main and candidate HEAD: f3b892815520fed72ba0bdd8970924eea9676086. Preserved original medical main HEAD: be9f1bf89f53462f1cbebf83aa29929dcca440c2. After the authorized fetch, original origin/main points to f3b8928; merge-base is be9f1bf, ahead=0/behind=96. The 96 commits change 72 paths. Main areas: collector parser/source robustness and tests, alert engine/runner, workflows/release notes, Admin authorization/server-only monitoring and public UI. Root supabase contains only the two original migrations; no additional migration/history script/version appears. No package or lockfile changed across the 96 commits. Existing Admin security change 8022e46 introduces the collector_runs service-only SELECT migration and server-only Admin Supabase client.

Today Shoes latest main and candidate HEAD: c431e71a3b328b8eaaefeb1bf86abdc96f6aca21, unchanged from the approved baseline. Original Today workspace has unborn main and no origin remote; its app files remain untracked and untouched. Latest origin/main was verified through a fresh separate clone and read-only GitHub branch GET rather than inventing an origin for the original workspace. Both live remote SHAs were rechecked at the end.

## B. Checkout Reconciliation

Candidate roots:
- medical: /private/tmp/running-main-reconcile-20261002-01/medical
- today-shoes: /private/tmp/running-main-reconcile-20261002-01/today-shoes

These are independent latest-main clones, not merges/rebases of the dirty original. Candidate main HEADs remain the cloned upstream commits. Only explicit Phase additions were transferred. No original branch movement, force checkout, reset, clean, pull, stash or overwrite was used. Original medical tracked 2 + untracked 34 files and original Today 60 files are byte-identical to backups. Inventory/backups/security JSON are outside candidate repositories under /private/tmp/running-main-reconcile-20261002-01.

## C. Conflicts Found

No textual path collision for new running/Contract candidates. The two original medical migrations already exist on main and match their immutable hashes, so they were not transferred or edited. Existing medical package/test scripts remain unchanged; additions are root tooling/tests and do not alter existing CI.

Semantic adjustments:
1. Synthetic collector_runs identity changed from ALWAYS to BY DEFAULT and result from unrestricted varchar to varchar(20), matching current main medical-briefing-bot/collector_runs.sql. Its observed broad legacy privilege fixture remains deliberately represented; the current repository's GRANT statements are additive and do not establish a complete Production ACL snapshot.
2. API integration's absolute original workspace imports were replaced by RUNNING_CONTRACT_ROOT with a sibling-checkout default.
3. A reproducible guarded disposable runner was added: fresh directory/no migration startup, completed empty stack, then fixture/history and bundle placement, CLI gate and only-new apply. It refuses unexpected migration inventory.
4. Stale “not executed/CLI absent” instructions in running-core-v1.md were replaced with current evidence and guarded sequence.
No production running SQL change, existing public/Admin/collector source change or migration version change was required.

## D. Running Migration Version

20261002054701 remains safe relative to current main originals 20260928000000 and 20260928010000 and the historical mapping versions 20260928064906/20260929063328. No collision or intervening newer migration.
Running content SHA-256: 73ebeb3c43db5c8d0ba817a16420f92dead1d82a1a35286a2a22cd0125b7e7ac.
Original hashes: b99c64a3ff71a9a313ad865e069b314468a73cfd3849b3faf86df7ac1d9d0c0b and c07251270dd8dcacc96d4f6f444ea88cab46b0db767d0f5676bbcf1f57141d41.
Actual Production history was not accessed this phase; offline approved mappings remain test inputs and require fresh pre-flight verification.

## E. Files Transferred

Transferred running migration, all five supabase/tests fixture/test files, two bundle script/test files, core documentation and the historical disposable report. Transferred Today Contract's five files. Excluded original supabase/config.toml, original generated .diff, original checkout log, all user Python/.DS_Store files, app files and existing migration copies. Candidate-only modifications/additions are identified in C and the exact lists L/M.

## F. Disposable Regression

Entirely fresh local project/directory; previous stack results not reused. CLI 2.119.0, PostgreSQL 17.11. API loopback 127.0.0.1:55321, DB 55322. Empty startup succeeded without --ignore-health-check or migrations, then synthetic baseline/history loaded. No linked project or inherited Production credential environment.

- pgTAP: **83/83 PASS**, no skip/failure.
- JWT/API: **15/15 PASS**, 14 subtests plus parent; counts unchanged.
- service_role: SQL schema and five table privileges denied; SQL/API 42501, not zero-row masking. Medical service article/collector/alert operations succeed.
- Contract-to-DB: real relocated Contract import/fixture, valid HealthKit/manual, identity replay, NULL/0 distance, pace and HR NULL; invalid UUID/HR/duration rejected.
- Audit/revision: timestamps managed by DB, revision increments/stale zero-row update, forbidden audit/identity writes denied; generated pace 428C9.
- Medical: catalog snapshot remains equal before/after running and API; public read/service write behavior maintained.
- Rollback: independent local DB, deliberate 22012 before COMMIT, no running schema and unchanged medical snapshot.
- Auth: local synthetic users cleaned; final auth.users count=0.
- Bundle tests: **4/4 PASS**. A new harness is exercised through the real full-stack scenario; no tautological unit tests were added.

## G. Today-shoes Regression

Latest-main Contract **56/56 PASS**, strict TypeScript exit 0, Biome **8 files clean** across candidate JS/TS/JSON plus new harness. Package/lockfile unchanged, temporary compiler/linter cache only. LSP unavailable; actual compiler/lint/runtime checks passed. Native TS module-type warning remains because Expo manifest was preserved. No whole application build or new app functionality is claimed.

## H. Migration Pending Verification

Real CLI db push --local --dry-run output contains exactly:
20261002054701_running_core_v1.sql.
Old pending=0, running pending=1. CLI apply executes only that version. Final DB history contains the two synthetic historical records and new running_core_v1.

Fresh evidence root:
 /var/folders/xk/7j9jfccs3w90_vx9sfnwqnn80000gn/T/running-main-disposable-OpQxY6

Verified bundle: verified-bundle/manifest.json has pending_verified=true.
Manifest SHA-256: 280069326623d061a4cbce91d59bb58e83aab2b392f9e3d45b373076990d7d83.
Full bundle SHA-256: 4e4dab101149551428081871903ad05be00367a2fd013389b1b7253e6fcb15be.
Digest algorithm: lexically sorted relative file paths (manifest and three SQL files), append UTF-8 path + NUL + file bytes + NUL for each, then SHA-256. Bundle contains no config, .env, credentials or link metadata.

## I. Replay Incident Documentation

Historical incident retained in running-disposable-verification.md: bundle mirrors were placed before an earlier stack start had completed; CLI reinitialization ran the first historical mirror, then the second failed with missing collector_runs. Impact was confined to that disposable local stack. Production and original migration files were unchanged. The failed environment was rebuilt from empty startup plus synthetic fixtures/history. Its final successful run and this latest-main fresh run expose only the running version as pending/apply, with no old migration replay. No Production history repair, rename, renumber or old SQL edit was performed. Guarded runner orders startup before any mirror placement and verifies the actual local history.

## J. Security Review

Candidate additions checked by content review and encoded-key/JWT/connection/project-ref scanner: no credential values, service keys, DB password, Production project ref, real user data/Auth identity, .env or local Supabase/Docker/link state in the diff. All fixture UUIDs/emails/dates are synthetic; domains are example.invalid. Local status credentials are memory-only, subprocess logs redacted; inherited env restricted to PATH/HOME/TMPDIR plus explicitly local test variables.
Running SQL grants neither PUBLIC, anon nor service_role schema/table/function privileges. Authenticated grants are allowlisted; pure CHECK helpers only; no SECURITY DEFINER; owner/active-profile RLS and immutable ownership/identity. Existing default ACL/public grants remain untouched. Project-wide Auth Admin remains a shared-project trust boundary, not app isolation.
security-and-preservation.json outside the clone holds candidate hashes and backup byte comparison. It is generated evidence and not a commit candidate.

## K. Final Diff Review

Review-work main-session manual QA and self-review: **PASS**, confidence HIGH for requested local criteria. No independent reviewer or PR approval claimed. Candidate existing tracked files have zero unstaged/staged diff; all intended additions are untracked. Full addition patches are medical-candidate.patch and today-shoes-candidate.patch outside the repositories.

| Class | Candidate files |
|---|---|
| A. Production code/schema | medical running SQL; Today workoutContractV1.ts and workoutContractPrimitives.ts |
| B. Tests | medical pgTAP/API and bundle .test.mjs; Today Contract .test.mjs |
| C. Fixtures | medical medical_baseline.sql, production_history_baseline.sql, production-history.json; Today workout-contract-v1.json |
| D. Tooling | prepare-running-deployment-bundle.mjs, verify-running-disposable.mjs; Today tsconfig.contract.json |
| E. Documentation | four docs listed below |
| F. Temporary/generated (EXCLUDED) | clones' .git metadata; temp CLI/cache/config/local state/containers; bundle/manifest/raw logs; backups/inventory/audit JSON/regression notes and generated candidate patches; original running-disposable-tests.diff and checkout notes |

Context mining: Admin security 8022e46 restricts collector_runs SELECT and moves monitoring to server-only service client; this explains retaining medical service permission while denying running service privilege. Collector schema on current main explains fixture identity/VARCHAR adjustment. Original migration/source hashes and no extra migrations explain retaining the running version. Unchanged Today main/package explains pure additive Contract placement. Historical replay explains guarded startup. Documentation stale claims and hardcoded API paths were corrected.

| QA | Evidence | Verdict |
|---|---|---|
| Fresh startup without migration replay | fresh evidence startup.txt + migration-apply.txt | PASS |
| One pending migration/history mapping | dry-run.txt + verified-bundle/manifest.json + catalog.txt | PASS |
| Core objects/RLS/grants/ownership/metrics | pgtap.txt (all 83 assertions) | PASS |
| Real local JWT/service/Contract/audit/cascade | api.txt (15 tests) | PASS |
| Medical snapshot/functions | pgtap.txt + api.txt + catalog.txt | PASS |
| Atomic failure rollback | rollback.txt | PASS |
| Today Contract/TS/lint/bundle | regression-checks.md outside clone | PASS |
| Original preservation/security/scope | security-and-preservation.json + per-file patches | PASS |

## L. Commit Candidate — medical

Repository root: /private/tmp/running-main-reconcile-20261002-01/medical. Exact **13 files**, all additions:
1. supabase/migrations/20261002054701_running_core_v1.sql
2. supabase/tests/running_core_v1.test.sql
3. supabase/tests/running_api_integration.mjs
4. supabase/tests/fixtures/medical_baseline.sql
5. supabase/tests/fixtures/production_history_baseline.sql
6. supabase/tests/fixtures/production-history.json
7. scripts/prepare-running-deployment-bundle.mjs
8. scripts/prepare-running-deployment-bundle.test.mjs
9. scripts/verify-running-disposable.mjs
10. docs/running-core-v1.md
11. docs/running-disposable-verification.md
12. docs/running-production-preflight.md
13. docs/running-main-reconciliation.md

One logical medical running-core commit/PR unit with directly related tests, fixture/tooling/docs. Existing migrations, application, package, original user edits and generated state excluded. Do not commit directly on main; a future authorized branch can be created from this verified baseline. No staging or commit performed.

## M. Commit Candidate — today-shoes

Repository root: /private/tmp/running-main-reconcile-20261002-01/today-shoes. Exact **5 files**, all additions:
1. src/import/workoutContractV1.ts
2. src/import/workoutContractPrimitives.ts
3. src/import/workoutContractV1.test.mjs
4. src/import/fixtures/workout-contract-v1.json
5. tsconfig.contract.json

Separate repository, therefore separate commit/PR. Runtime implementations are independent. Medical cross-contract regression requires a matching Today candidate checkout via RUNNING_CONTRACT_ROOT; document this test prerequisite when preparing later PRs. Today Contract can be reviewed/committed first after authorization. Existing app functions and dependencies excluded.

## N. Production Pre-flight Checklist

Prepared in running-production-preflight.md: current code/deployed HEAD, fresh migration history, running absence, Auth count, medical object baseline, exposed schemas, SQL hash, bundle hash, exactly one pending, containment/rollback, collector recent normal run, Admin monitoring, backup/restore feasibility and post-apply smoke tests. All fourteen are future checks, not executed Production operations.

## O. Remaining Risks

Actual current Production history/settings/backups/health not inspected this phase. Synthetic ACL/catalog reproduces relevant shape rather than every Production detail. Remote can advance after this verified SHA; fetch and resolve any change before commit/pre-flight. Shared Auth Admin trust boundary and existing Gemini public-key exposure remain. HealthKit adapter/Auth UI/cloud sync/Storage are outside core v1. Cross-repository integration test needs the Contract candidate. Runner assumes ports 55320–55322 available, keeps its unique stack and local evidence for review; local state is excluded from commits. Temporary clones/artifacts can be removed by OS cleanup; preserve candidate files before that. No whole medical/Expo app compile or deployed Admin UI smoke test was requested/executed; these belong to later pre-flight.

## P. Readiness

**READY FOR COMMIT/PR**. Latest-main reconciliation and all required new disposable regressions passed. This is not Production deployment readiness or authorization.

## Q. Change Confirmation

Production DB: unchanged/not connected.
Production Supabase settings/Auth/Storage/Edge/history: unchanged.
Production credentials: not used or exported.
Git branch: original main branches/HEADs unchanged; medical origin/main remote-tracking ref advanced by approved fetch; separate fresh clones use existing upstream main. No new feature branch created.
Commit/push/PR/Actions/Vercel: none.
GitHub access: fetch/clone/GET only.
Existing user/app/original migration files: byte-preserved.
Local changes: candidate additions/semantic fixture and test/docs adjustments; new Docker disposable stack and generated local evidence.
Estimated context/token usage for this phase: approximately 20,000–35,000 tokens, estimate only, not a measured account counter.
