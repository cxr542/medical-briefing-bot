# Running core v1

Status: READY FOR COMMIT/PR on latest main after fresh disposable verification. No Production deployment is authorized.

## Starting state and scope

Remote today-shoes main: `c431e71a3b328b8eaaefeb1bf86abdc96f6aca21`.
Remote medical main: `f3b892815520fed72ba0bdd8970924eea9676086`.
The today-shoes workspace started on unborn `main`, with no HEAD commit and no app source. The pinned remote tree was fetched and restored into the working directory without creating a branch or commit. Its existing package and lockfile were not changed.
The medical checkout at `/Users/yhkim/Documents/antigravity/joyful-hopper` started on `main`, HEAD `be9f1bf89f53462f1cbebf83aa29929dcca440c2`, with user modifications to `medical-briefing-bot/test_db.py` and `.DS_Store` plus untracked scripts. All were preserved. The two missing original migration files were copied byte-for-byte from the pinned remote revision; they were not renumbered or edited. This checkout remains behind the remote; merging/updating it is outside this task.

## Architecture

Existing medical uses `public`. Today Shoes uses new `running`, project-shared `auth.users`, and app-specific `running.profiles`. The app remains Expo/React Native/TypeScript. No frontend/backend medical source changes are required.
Five new tables: profiles, shoes, workouts, workout_shoes, import_batches. No shoe_images, clothes, outfits, outfit_items or races.

## Workout Import Contract v1

The entry point is `parseWorkoutImportV1(input: unknown)`, accepting a raw JSON string or an already decoded plain object and returning a normalized readonly Envelope. Expected input failures throw WorkoutValidationError with code/path and no input values. Raw JSON strings reject duplicate field names, including escaped-equivalent names. Decoded objects cannot recover duplicate JSON keys already discarded by a caller; pass raw file/request text at the boundary.

Envelope requires schema_version=1, persistent UUID batch_id and 1..100 workouts from one source. Maximum raw/serialized payload is 1 MiB UTF-8. Unknown envelope/workout keys are rejected. Repeated source/external_id pairs within a batch are rejected, not silently overwritten.

Workout required fields: source, external_id, started_at, ended_at, duration_seconds, duration_basis, distance_meters (number or null), sport_type. HealthKit requires healthkit_uuid. Other fields are optional and normalize to null for initial insertion.
Sources enabled in the validator: healthkit/manual. Source storage uses a lowercase slug (1..32 characters) so future registered adapters do not require a DB enum migration. Runtime source types/registry must be extended deliberately for other providers.
HealthKit external_id equals normalized lowercase workout UUID. Manual external_id is a persistent lowercase client UUID. Retrying never generates a new ID. Source-specific activity IDs with account-local scope must include a stable account namespace before enabling an adapter.

Dates require RFC3339 timezone; unknown offset -00:00 and invalid calendar dates are rejected. UTC ISO output uses milliseconds; finer fractional seconds are truncated by Date parsing. ended_at must be after started_at. Duration is positive and at most elapsed+1 second. duration_basis is active/elapsed/unknown.
Distance meters and active energy kcal are nonnegative or null; HR bpm is positive or null, with max>=average. Number strings, NaN/Infinity and excess precision are rejected. Duration/distance/calories use 3 decimal places, HR 2. Technical storage limits: duration/distance<1e9, calories<1e7, HR<1e4. They are representability limits, not physiological guidance. sport_type is running; is_indoor is boolean/null. source_app has 1..255 Unicode characters and no control characters.

Device allows manufacturer/model/hardware_version/software_version, strings of 1..128 Unicode characters, 2 KiB serialized JSON maximum. Empty device normalizes to null.
Metadata allows source_version/source_product_type/provider_activity_type/hr_method, scalar values only, 8 KiB maximum. hr_method is healthkit_statistics/provider_summary/manual. Empty metadata normalizes to null. No route/raw HR/credentials/provider response dump.
DB jsonb CHECKs validate shape, allowed keys and a conservative byte limit on PostgreSQL jsonb text. Original wire bytes and numeric precision before PostgreSQL typmod rounding remain validator responsibilities. JSONB inserts near the byte boundary may fail the conservative DB limit because its serializer adds spacing or renders numbers differently. JSON duplicate keys are a raw validator responsibility.

## DB schema and ownership

Profiles user_id references auth.users with cascade; membership deletion never deletes Auth. Self-controlled status active/inactive and onboarding pending/complete are not administrator bans.
Shoes preserve legacy_local_id, nickname/brand/model/traits/recommendation/photo_source/gemini_analyzed/seed_file. UUID internal identity is separate from the local string ID. Images/URIs are never copied into the DB.
Workouts store all canonical fields, generated pace, optional batch link, revision, deleted_at and DB audit timestamps. `(user_id,source,external_id)` is UNIQUE. `(user_id,id)` enables composite ownership FKs. Batch links additionally require the same source. NULL batch references are allowed; deleting a batch clears only import_batch_id.
Workout/shoe links have composite PK and FKs. Single linked shoe deletion is prevented. The shoe FK uses NO ACTION, checked at statement end, so a profile cascade can remove both links and shoes; this withdrawal scenario must pass the disposable tests.
Import batches contain schema_version/source, received and outcome counts, started/finished/audit times and status. Received count is 1..100. Terminal states require finished_at and complete accounting. completed has no failures; partial has some failures; failed has all failures. Counts are client-reported telemetry, not trusted audit evidence.

## Audit, pace, RLS and GRANT

One SECURITY INVOKER trigger, only in running, stamps created_at on INSERT and updated_at on UPDATE; workout revision starts at 1 and increments on UPDATE. The trigger preserves created_at on UPDATE even for privileged callers. Client INSERT/UPDATE grants exclude audit and generated values. Stamp function is not client-callable.
Generated pace = duration_seconds*1000/distance_meters, NULL for unknown/zero distance. Its interpretation depends on duration_basis; it is not an authoritative payload field.
All five tables enable RLS. Profiles enforce auth.uid()=user_id; business tables additionally require an active profile. SELECT/DELETE use USING, INSERT uses WITH CHECK, UPDATE has both. No SECURITY DEFINER bypass is used.
PUBLIC/anon/service_role receive no running schema/table/sequence/function access. authenticated has schema USAGE and explicitly listed column INSERT/UPDATE plus SELECT/DELETE. Link PK/ownership columns are immutable: link changes use delete+insert. An UPDATE policy still exists but no link UPDATE permission is granted.
Two pure validation helper functions need authenticated EXECUTE for DB CHECK evaluation. They read no tables and convey no authorization. Audit trigger execution is not granted. Existing public privileges/default ACLs are unchanged.

## Idempotency and refresh

Initial import uses insert then handles UNIQUE conflict as skip/read-existing. Do not use an unconditional overwrite upsert. Refresh is explicit and uses WHERE revision=<observed revision>; the DB increases revision. A stale PATCH changes zero rows. Metric refresh must not remove shoe links or resurrect deleted_at tombstones.
The validator materializes optional NULL values for initial INSERT, not a refresh PATCH. Refresh needs a separately constructed presence-aware whitelist; omitted optional fields must not become clear-to-null operations. No importer/outbox implementation is provided in this phase.

## Shoe local mapping

Local id -> legacy_local_id; internal DB id is a new UUID. Local createdAt milliseconds -> legacy_created_at, a separate optional immutable import field. DB created_at remains server-managed as required by this implementation phase. This avoids losing the original local creation time or treating it as server audit time.
Other textual fields map directly; source -> photo_source; geminiAnalyzed -> gemini_analyzed; seedFile -> seed_file. imageUri/front/left/right remain local-only.
First sync must preserve the local collection, ask which logged-in account claims pre-account local data, use user-scoped migration journal and local-to-cloud ID map, and retry the same legacy ID. UNIQUE(user_id,legacy_local_id) prevents repeat inserts. Never silently overwrite an existing cloud row. This is a design, not implemented sync.

## Migration strategy and deployment bundle

The new file is 20261002054701_running_core_v1.sql. Its timestamp was generated in the earlier phase when CLI was absent. CLI 2.119.0 now verifies it as the only pending migration. Latest main contains only the two original medical migrations; no version change is needed. Existing versions were not changed.
Never run db push/reset/start directly from this checkout's legacy migration folder. It does not contain a complete medical genesis schema and its timestamps differ from Production history.
prepare-running-deployment-bundle.mjs is offline. It requires a version/name history JSON, verifies immutable original hashes, creates a fresh exclusive output directory with history-version mirrors plus the new migration, and emits a manifest. No key/config/linked-project state is copied. A caller-supplied pending-version list may be checked; this is not a substitute for executing the actual CLI dry-run.

Mappings:
- 20260928000000 -> 20260928064906 collector_alert_state
- 20260928010000 -> 20260929063328 20260928010000_collector_runs_admin_only

In the final verified procedure, old mirror SQL is not replayed: matching synthetic history versions mark it applied. An earlier local startup accidentally replayed the first mirror and failed on the second; the incident is retained in running-disposable-verification.md. History fixtures are local synthetic markers only. Original SQL hashes in the bundle are SHA-256.

Offline bundle command (local file creation only):
```sh
node scripts/prepare-running-deployment-bundle.mjs --history supabase/tests/fixtures/production-history.json --output /private/tmp/NEW_UNIQUE_BUNDLE
```
Before a future deployment, read actual current history again. Any extra/version/name difference blocks bundle preparation. A disposable dry-run must report exactly the new migration; pass that result as --pending OFFLINE_PENDING_JSON. No Production repair/replay/push is authorized here.

## Testing

Latest-main verification passed: pgTAP 83/83, JWT/API 15/15, Contract 56/56, bundle tests 4/4, strict TypeScript and Biome lint. The original checkout remains preserved; the commit candidate is in the separate latest-main directory. See [running-main-reconciliation.md](running-main-reconciliation.md) for exact SHAs, evidence, diff classification and candidates.

Use the guarded disposable runner from the medical candidate, with a supported installed CLI and the separate Today Shoes Contract checkout:
```sh
RUNNING_LOCAL_CLI=/absolute/path/to/supabase \
RUNNING_CONTRACT_ROOT=/absolute/path/to/today-shoes \
node scripts/verify-running-disposable.mjs
```
The runner creates a fresh temporary directory and unique local project. Ports 55320/55321/55322 must be free. It starts with public-only API exposure and no migration directory; only after successful empty startup does it load synthetic baseline/history, copy the offline bundle, execute actual local dry-run, verify one pending running version, apply the new migration, and expose running locally. This ordering prevents the previous mirror replay incident. Never start/reset the repository or a deployment bundle directly.

The runner strips inherited service/Production environment variables, reads local credentials from CLI status into memory, accepts only the expected loopback endpoint and records redacted evidence. It executes pgTAP, JWT/API and rollback tests, then retains the disposable stack for review. No repository config, .env, Production credentials or project link is needed. Existing migration files are hash-checked and remain unchanged.

The API test uses RUNNING_CONTRACT_ROOT, defaulting to an adjacent today-shoes checkout. This cross-repository fixture test dependency does not couple the two production implementations. Native TS stripping requires Node 22.18+ or a supported newer runtime; verified with Node 25.9.0. The existing Expo manifest is unchanged, so its module-type warning remains.

Today Shoes checks from its candidate root:
```sh
node --test src/import/workoutContractV1.test.mjs
tsc --project tsconfig.contract.json
```
No existing app source, package/lockfile, Auth UI, cloud sync or HealthKit implementation is changed. Whole Expo/medical application build is outside this regression scope.

## Rollback

The migration is a single transaction. Disposable failure injection before COMMIT has now passed: SQLSTATE 22012, no partial running schema, medical snapshot unchanged. The psql failure experiment does not create CLI migration-history rows.
After a future deployment, disable running import/cloud features first and preserve/export data before removal. Only running objects are rollback candidates. Do not remove auth.users, medical tables/policies/grants/indexes or change existing history. There is no Storage rollback in core v1. No destructive rollback SQL is executed or auto-generated.

## Known limitations

- Storage and shoe_images are not implemented; images stay local.
- HealthKit adapter, cloud sync/outbox and Auth UI are not implemented.
- Gemini EXPO_PUBLIC_GOOGLE_AI_API_KEY exposure remains HIGH priority. Future authenticated server/Edge Function calls Gemini using a server secret and user JWT for DB operations, not service_role by default.
- Shared Project service trust boundary remains: DB object privileges restrict direct running access, but project Auth Admin capabilities and Storage service bypass are not isolated app boundaries.
- Migration history mismatch remains. Original migrations/history were not repaired.
- Public medical articles remain readable by any public client, including Today Shoes users. Existing broad public SQL grants are not changed.
- The original medical checkout remains behind remote with user edits preserved. A separate latest-main commit candidate has now been reconciled; see running-main-reconciliation.md.
- Disposable verification completed: pgTAP 83/83, JWT/API 15/15, actual CLI pending only 20261002054701, verified bundle pending_verified=true, rollback passed. See [running-disposable-verification.md](running-disposable-verification.md) for the full A-S report, initial local mirror replay mistake, environment caveats and every assertion. Production remains unchanged.
- pgTAP fixture reproduces the relevant schema/permission shape with synthetic values, not every historical database setting or application runtime route.
- Future providers require explicit adapter/source registry changes; DB acceptance of a slug does not mean an importer is implemented.
