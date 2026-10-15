# Release Note automation E2E test

## Purpose

Prepare a documentation-only source PR to verify the PR-based Release Note
workflow introduced by #86. Creating this test PR verifies ordinary PR CI only;
it does not prove the post-merge generator or GITHUB_TOKEN CI approval flow.

## Procedure and expected results

1. Keep this source PR open with the `release-note` label and the agreed metadata:
   Category `운영`, Title `Release Note PR 자동 생성 검증`.
2. Verify the exact source HEAD's release guard, release-note data tests, and
   offline Collector regression results. Path-filtered frontend workflows are
   not expected to run for this documentation-only diff.
3. Stop for user review. Do not merge this PR or manually dispatch/re-run any
   operational workflow as part of preparation.
4. Only after separate authorization, a source merge should trigger Auto release
   note and create `automation/release-note/pr-{source PR number}` plus one note
   PR. It must not push main directly or modify the published JSON immediately.
5. Inspect the generated note PR: exactly one JSON file, one new unique source
   ID, and unchanged existing entries, dates, links, order, and manual content.
   Verify its No Release Note contract and absence of the release-note label.
6. Check whether eligible GITHUB_TOKEN PR workflows require user approval. A
   missing, pending, skipped, or approval-required run is not a successful check.
   Review exact HEAD CI before considering any separately authorized note merge.

## Production impact

This preparation changes one document only. No application, Collector, Recovery,
Alert Engine, Supabase, secret, environment variable, or deployment setting is
changed. Existing Git integration may create Vercel Previews. A future source
merge and note merge may each trigger normal Production deployments; neither is
included in this step's authorization. The operations screen will not show the
new note until its separate PR merges and the resulting deployment succeeds.

## Recovery

Before source merge, leave the PR open for review or close it with user approval;
no release-data rollback is needed. If later generation fails, preserve its
branch and manual edits, record source/main/head SHAs and run results, and classify
ambiguous state as NEEDS REVIEW. Follow the authorized dry-run reconciliation and
forward-only recovery procedure in release-note-pr-automation.md. Do not force
push, reset main, delete historical notes, or manually execute Collector/Recovery.
Any live retry, note-PR merge, or correction requires separate authorization.
