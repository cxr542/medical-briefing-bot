# Collector scheduling contract

Confirmed on 2026-10-12 against main
`df06122fdbc130c37ee69471bd472db7a5456463`. This document records the observed
production configuration; it does not provision a scheduler or change runtime behavior.

## Normal collection

```text
cron-job.org
  → https://medical-briefing-bot.vercel.app/api/cron/collector-dispatch
  → GitHub API workflow_dispatch (daily_collector.yml, ref=main)
  → GitHub-hosted ubuntu-latest runner
  → collector.py
  → Supabase collector_runs
```

| Enabled cron-job.org job | Asia/Seoul cron | Runtime KST | Display KST |
|---|---|---|---|
| Medical Briefing Collector - Morning | `30 8 * * *` | 08:30 | 08:30 |
| Medical Briefing Collector | `7 12,15,17 * * *` | 12:07, 15:07, 17:07 | 12:00, 15:00, 17:00 |

The operator directly inspected these production jobs and supplied their enabled
state, target URL, Asia/Seoul timezone, schedules, and successful `202 Accepted`
history. The agent did not independently read the authenticated cron-job.org console.
Morning history on 2026-10-12 recorded the 08:30:00 reservation and 08:30:18 execution.
The supplied afternoon history recorded 12:07:04, 15:07:04, and 17:07:04; dates
were not supplied for those three entries, so they are corroborating time patterns,
not asserted matches to particular GitHub run IDs.

The Common screen did not show the configured HTTP method:
**METHOD_NOT_DIRECTLY_VERIFIED** for the scheduler setting. Repository contract:
the relay accepts only authenticated **POST**; GET/HEAD and the other methods
return 405. With `CRON_SECRET` and `GITHUB_DISPATCH_TOKEN` configured on the
server, POST dispatches the fixed repository/workflow/main ref. GitHub requests
have a 10-second timeout and no automatic retry; missing configuration is 503,
authentication failure is 401, upstream failure is generic 502, and acceptance is
202. No credential values are part of this document.

Two production Vercel projects were inspected, both serving the same main SHA:
`medical-briefing-bot` and `medical-briefing-bot-n7iy`. The operator's configured
URL selects the first project's `medical-briefing-bot.vercel.app` alias.
No tracked vercel.json/vercel.ts/now.json cron configuration exists:
**VERCEL_CRON_NOT_CONFIGURED** in the repository. The available deployment API
summaries do not independently enumerate live cron settings.

## Execution evidence

After the PR #66 cutover, the 15 observed Collector runs from 2026-10-08 15:07 KST
through 2026-10-12 08:30 KST were all:

- `workflow_dispatch`, branch `main`, actor `cxr542`, run_attempt=1;
- without a `recovery_slot=` marker;
- within seconds of 08:30, 12:07, 15:07, or 17:07 KST;
- matched to Supabase collector_runs IDs 82–96 by execution time window.

For the dated morning entry, the chain was:

| Boundary | 2026-10-12 KST |
|---|---|
| cron-job.org reservation (operator evidence) | 08:30:00 |
| cron-job.org execution, 202 (operator evidence) | 08:30:18 |
| GitHub run [38184526796](https://github.com/cxr542/medical-briefing-bot/actions/runs/38184526796) created | 08:30:20 |
| GitHub job started | 08:30:24 |
| collector_runs #96 started | 08:31:21.452385 |
| collector_runs #96 finished | 08:34:42.320198 |
| GitHub run completed | 08:34:46 |

Raw GitHub job metadata identified runner group `GitHub Actions`, runner name
`GitHub Actions 1000001714`, and label `ubuntu-latest`. The observed runner does
not depend on a local MacBook. Local machine configuration was not inspected:
**LOCAL_MACHINE_CONFIGURATION_NOT_DIRECTLY_VERIFIED**. Cloud scheduling is not
a guarantee of future service availability.

GitHub conclusions were success for all 15 runs, while the corresponding
collector_runs results were DEGRADED with db_failed=0. Successful triggering and
database persistence do not imply every collection source was healthy.
collector_runs has no scheduler name, GitHub run ID, or trigger column, so the
database correlation is temporal, not an explicit foreign-key linkage.

Vercel runtime-log retention did not cover the historical triggers. The recent
window returned no relay logs and did not include a scheduled slot; this is not
evidence of scheduler inactivity. No live relay request or manual Collector run
was made for this investigation.

## Schedule history and health behavior

1. [PR #45](https://github.com/cxr542/medical-briefing-bot/pull/45), merged
   2026-09-30 11:31:36 KST, commit
   `268867f65551fe19034facb70f71b21e398d8707`, intentionally replaced **06:07 KST
   with 17:07 KST** in the GitHub cron and runtime schedule. It centralized the
   current runtime/display arrays and retained the two-hour stale grace.
2. [PR #65](https://github.com/cxr542/medical-briefing-bot/pull/65), merged
   2026-10-08 14:00:19 KST, added the protected Vercel dispatch relay. Its statement
   that no external scheduler had yet been connected describes that historical
   implementation step, not the production configuration verified on 2026-10-12.
3. [PR #66](https://github.com/cxr542/medical-briefing-bot/pull/66), merged
   2026-10-08 14:57:30 KST, commit
   `143ef3f5813c13f6fa6014bb20e1f5362db55012`, intentionally removed only the
   Collector's GitHub schedule trigger and retained workflow_dispatch.

An old 06:07 **KST** schedule reference predates PR #45. A test timestamp such as
`2026-09-30T06:07:00.000Z` is **UTC**, equivalent to 15:07 KST; it is not an old
06:07 KST slot and must not be replaced on that basis.

Health Engine reads COLLECTION_RUNTIME_SCHEDULE_KST from collectionSchedule.mjs;
it does not parse GitHub workflow cron. Runtime slots are expected collection
times, not promises that collector.py starts at that exact second. Display slots
are presentation labels, not scheduler trigger times. Staleness begins only
after the next expected runtime slot plus the existing two-hour grace.

## Recovery and duplicate scheduling

The separate Collector Alert Engine workflow retains `*/15 * * * *` and evaluates
health/recovery. Its workflow_dispatch accepts a dry-run option. Recovery can
dispatch the Collector with a `recovery_slot=` marker using github-actions[bot].
This is distinct from normal cron-job.org scheduling. Historical marked recovery
runs were excluded from the 15 normal-run comparison.

Recovery checks active workflow runs and the previously attempted slot. The relay
does not perform slot-level deduplication. Collector concurrency serializes runs
but does not discard a second queued run (`cancel-in-progress: false`). Therefore
adding GitHub cron again could duplicate collection requests, HTTP/DB work, health
history, and deletion reconciliation; it must not be used to satisfy a stale test.
Current collector.py does not perform AI generation, so no duplicate AI calls were
observed or claimed; future processing would inherit the duplicate-run risk.

## Test contract and scope

The old test correctly described pre-PR #66 GitHub scheduling, but its requirement
for Collector cron entries became **STALE_TEST** after the intentional cutover.
Tests now keep the runtime/display assertions and also require:

- the Collector's only trigger to be workflow_dispatch (no second normal scheduler);
- a GitHub-hosted runner configuration;
- the separate Alert Engine's scheduled recovery evaluator and Actions permission.

The existing relay, stale-boundary, source-health, and recovery tests remain.
This change edits tests/documentation only. It changes no schedule, production
configuration, Collector identity/lifecycle, recovery code, dispatcher code, or
source_detail_url work. Rollback is this PR's code revert; no DB rollback is needed.

## Offline verification

- Clean main Health Engine baseline: 14 tests, 13 passed, 1 failed (obsolete cron assertion).
- Updated Health Engine: 16/16 passed; no test was skipped or deleted to hide the failure.
- Python Collector regressions: 143 tests, 142 passed, 1 optional native smoke skipped.
- Recovery runner: 17/17; Admin security: 9/9; Admin routes/local fixture: 7/7.
- Frontend: 143/143, including relay and PR #70/#71 source-link regressions.
- Release-note guard: 6/6. TypeScript, ESLint, and diff check passed.
- Total unique tests: 341, with 340 passed, 0 failed, 1 skipped.
- Default Turbopack build hit a Cloud listener EPERM environment error. The production
  `next build --webpack` build passed with a command-local non-production Supabase
  URL and fake key, normal font fetching, and no font mocks or application changes.
- Admin integration initially could not start because a previous test left a local
  Next server running; after stopping that test-owned process, all seven passed.

These checks do not dispatch the production workflow, modify production configuration,
or prove physical Safari/iPad behavior. Remote PR CI and Preview results are reported
separately from these local checks.
