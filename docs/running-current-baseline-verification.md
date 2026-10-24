# Running local baseline verification - 2026-10-24

Result: local regression passed. Production deployment remains unapproved and blocked by the separately observed medical source-health issues. This report does not replace a fresh Production pre-flight.

## Baseline and scope

- Medical base: `4fab8ecb1b5197f4d793510bad3b803927dfee0f`.
- Today Shoes contract checkout: `99017f83e2146ad7a2a59ae73c049c32a9b6906b`; contract source unchanged.
- Existing installed Supabase CLI 2.81.3, Node 25.9.0, Docker daemon 27.4.0. No dependency installation or CLI upgrade.
- Seven synthetic history rows match the previously observed version/name inventory, ending at `20261019041429`. Marker statements are synthetic, not copied Production ledger contents.
- Fixture reconstructs public articles/collector tables, customer_auth (6 tables), support (10 tables), Auth/Storage managed schemas and two private attachment buckets. Customer auth schemas come from repository SQL without inventing three absent history rows. No customer, password, session, support or Storage object data is exported from Production.
- This is a relevant schema/privilege regression fixture, not a complete Production backup or application runtime verification.

## Observed results

| Check | Result |
| --- | --- |
| Offline bundle tests | 6/6 |
| pgTAP | 88/88 |
| JWT/API integration | 15/15 |
| Today Shoes Contract | 56/56 |
| Actual local CLI dry-run | Only `20261024000000_running_core_v1.sql` pending |
| Verified local bundle | `pending_verified=true`, `production_approved=false` |
| Transaction failure before COMMIT | No partial running schema; full fixture catalog unchanged |
| Successful apply and API exercise | Medical/customer_auth/support/Auth/Storage catalog, function definitions, ACLs, policies, triggers, defaults and bucket configuration unchanged |
| Ledger | Original seven rows preserved; only one running row added |
| Synthetic Auth users | Zero remain after API cleanup |
| Cleanup | Only this runner's stack and disposable volumes removed |
| Source SQL hash | `73ebeb3c43db5c8d0ba817a16420f92dead1d82a1a35286a2a22cd0125b7e7ac` unchanged |

The candidate deployment version is for local testing only. Bundle format v2 requires an explicit valid timestamp after all seven history versions, pins the immutable source hash, and records the original source version separately from the bundle filename. It does not rename repository migrations, repair history, replay historical SQL or grant Production approval.

API regressions include denied anonymous/authenticated article reads, denied public customer authentication/admin/support RPCs for running users, preserved service article reads/collector writes, cross-user isolation, duplicate replay rejection and revision checks.

## Evidence and reproduction

Final full disposable run: `/var/folders/xk/7j9jfccs3w90_vx9sfnwqnn80000gn/T/running-main-disposable-lGwF8C`.
Retained evidence: `dry-run.txt`, `pgtap.txt`, `api.txt`, `rollback.txt`, `catalog.txt`, `cleanup.txt`, and `verified-bundle/manifest.json`. Temporary paths are local evidence, not durable deployment inputs. Local credential log redaction was additionally checked for JWT, API keys, S3 access/secret keys and DB URLs.

```sh
node --test scripts/prepare-running-deployment-bundle.test.mjs
RUNNING_LOCAL_CLI=/absolute/path/to/installed/supabase \
RUNNING_CONTRACT_ROOT=/absolute/path/to/today-shoes \
node scripts/verify-running-disposable.mjs
```

Initial attempts found a fixed-port collision with an older stack, then missing Storage tables when Storage was disabled. The runner now chooses available ports and enables Storage before loading fixtures. The failed stack created by this task was removed; pre-existing stacks were preserved. The existing Today Shoes module-type warning remains; all 56 Contract and 15 API tests pass.

## Remaining gates

Review/merge this local tooling update, confirm the post-merge collector alert recovery behavior, and resolve or explicitly assess the previously observed DailyMedi partial snapshot and HIRA e-evaluation click failure. Then run a separately authorized fresh Production pre-flight, review the deployment version, and obtain explicit Production migration approval. No Production readiness claim follows from these local tests alone.

This work made no Production Supabase read/write connection, DB/Auth/Storage/Edge/settings/history/credential change, Vercel setting change, manual Actions dispatch, or force push. Repository application sources, dependencies and all existing migration SQL are unchanged.
