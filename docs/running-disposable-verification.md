# Disposable Supabase verification — 2026-10-02

Historical first disposable run. The current latest-main candidate and its new independent regression evidence are documented in [running-main-reconciliation.md](running-main-reconciliation.md). Historical paths, fixture shape and readiness below describe that earlier run; the replay incident remains preserved. Current API tests use configurable RUNNING_CONTRACT_ROOT.

판정: **READY FOR PRODUCTION PRE-FLIGHT**. 이는 Production 실행 승인이 아닙니다.

## A. Environment

macOS Darwin/arm64; Node 25.9.0; npm 11.12.1; Homebrew 있음. Docker client 27.3.1, daemon 27.4.0. Supabase CLI 2.119.0을 공식 npm 방식으로 임시 디렉터리에만 설치. 별도 psql 설치 없이 컨테이너 psql 사용. 로컬 PostgreSQL 17.11, PostgREST 16.4, GoTrue 2.197.0.

## B. Medical Checkout Consistency

로컬 main/HEAD 및 cached origin/main: be9f1bf89f53462f1cbebf83aa29929dcca440c2. 실제 원격 main: f3b892815520fed72ba0bdd8970924eea9676086. merge-base는 로컬 HEAD, 원격 96 commits ahead. GitHub GET compare로 변경 경로를 확인함. 기존 사용자 tracked 변경은 .DS_Store와 test_db.py(5 additions/8 deletions). untracked 사용자 Python 파일 및 Phase 파일을 백업. 원격 변경과 Phase 작업의 경로 중복은 기존 migration 두 개뿐이며 원본 hash 일치. merge/rebase/reset/clean/checkout/branch 변경 없음. 추가 세부 기록: /Users/yhkim/Documents/ChatGPT/today-shoes/disposable-checkout-consistency.md.

## C. Disposable Environment

/private/tmp/running-disposable-20261002-02. project_id running-disposable-20261002-02. Production linked project-ref 파일 없음. child process 환경에는 PATH/HOME/TMPDIR만 전달하며 Production env/credentials 사용 없음. 로컬 CLI status에서 얻은 local credentials를 메모리로만 API test에 전달. 최종 API endpoint http://[::1]:54321, DB loopback 54322. Docker stack은 재현/검토를 위해 현재 실행 중. 디렉터리에 사용자 파일 백업 archive, 검증 runner, 로그, bundle 보존.

## D. Migration History Verification

실제 CLI db push --local --dry-run: pending은 20261002054701_running_core_v1.sql 하나뿐. 20260928064906 / 20260929063328은 pending 아님. 원본 hash 각각 b99c64a3ff71a9a313ad865e069b314468a73cfd3849b3faf86df7ac1d9d0c0b / c07251270dd8dcacc96d4f6f444ea88cab46b0db767d0f5676bbcf1f57141d41 일치. 최종 /private/tmp/running-disposable-20261002-02/verified-deployment-bundle/manifest.json: pending_verified=true. 신규 SQL hash 73ebeb3c43db5c8d0ba817a16420f92dead1d82a1a35286a2a22cd0125b7e7ac. 기존 history repair/원본 rename/renumber/edit 없음. 실패한 초기 로컬 실행의 mirror replay 실수는 N에 별도 기록.

## E. Migration Execution

CLI db push --local --yes로 신규 migration만 적용 성공. BEGIN/COMMIT 단일 transaction. 5 tables, 총 16 indexes(제약 index 포함), 5 non-internal audit triggers, RLS 5 tables, 20 policies, UPDATE USING/WITH CHECK 5개, grants 적용. 최종 history 3 rows: 기존 synthetic 2 + running_core_v1.

## F. pgTAP Result

83/83 PASS; 실패/skip 없음. 전체 assertion은 문서 마지막에 기록. 원본 전체 로그 /private/tmp/running-disposable-20261002-02/pgtap-output.txt.

## G. JWT/API Result

15/15 PASS(부모 test 1 + subtests 14). local Auth로 A/B/profile 없는 사용자 생성 및 password JWT 발급 후 정리. A CRUD 성공; B SELECT/UPDATE/DELETE 0 rows; B 소유 INSERT 42501; B shoe FK 23503; profile 없음/inactive insert 거절; inactive 조회 숨김; 재활성화 조회 복구; profile 삭제 cascade 후 Auth admin 조회 유지, profile 재생성 후 business 4 tables empty로 실제 cascade 확인.

## H. service_role Result

SQL schema USAGE=false 및 5 tables SELECT/INSERT/UPDATE/DELETE privilege=false. SQL running 접근 42501. 실제 API GET/POST/PATCH/DELETE는 401/403 + 42501로 거절되며 단순 0 rows가 아님. anon도 거절. synthetic medical article read, collector_runs insert, alert_state update는 성공.

## I. Contract ↔ DB Result

실제 Today Shoes parseWorkoutImportV1 및 fixture를 DB payload로 변환. HealthKit/manual INSERT 성공. HealthKit 및 manual 동일 identity replay 409/23505로 duplicate 차단. distance NULL/0 -> pace NULL; 5000m/1800 active seconds -> 360 seconds/km(전체 elapsed 2100초와 구분). HR NULL 유지. UUID mismatch/HR 관계/duration 0 또는 elapsed tolerance 초과는 400/23514.

## J. Audit/Revision Result

DB created_at 유지, metric UPDATE 시 updated_at 증가, revision 1->2. stale revision PATCH 0 rows. API PATCH created_at/updated_at/revision/user_id/id/source/external_id/healthkit_uuid 거절 42501. INSERT created_at/updated_at/revision/id 거절 42501. generated pace INSERT/PATCH는 PostgreSQL generated-column 보호 400/428C9. 생성 시 source/external_id/healthkit_uuid/user_id는 계약에 필요한 허용 입력이며 변경은 불가.

## K. medical Regression Result

migration 전후 및 API 후 catalog snapshot 동일. columns/constraints/indexes/RLS/FORCE RLS/policies/grants/triggers/default privileges 포함. public article read 성공, collector_runs public read 차단, service collector write/alert write 성공. synthetic fixture 범위이며 기존 앱 source/runtime 전체 회귀검증을 의미하지 않음.

## L. Rollback Result

별도 local running_rollback DB에 synthetic medical fixture + 최소 auth.users/auth.uid 준비. 신규 migration의 COMMIT 직전에 division-by-zero 주입(SQLSTATE 22012). ON_ERROR_STOP 후 연결 종료로 transaction rollback. no_partial_schema=true, medical_unchanged=true. 실패 실험은 CLI history INSERT를 실행하지 않는 psql transaction이므로 신규 history row 생성 경로 자체가 없음. Production data rollback 수행 없음.

## M. today-shoes Regression

Contract 56/56 PASS; strict TypeScript exit 0; Biome 7 files clean; bundle native tests 4/4 PASS. 기존 Expo dependency/manifest/lockfile 변경 없음. Node TS native strip의 module-type warning은 기존 manifest를 보존하여 남아 있음. LSP는 이전 설치 거절로 미사용; compiler/lint/runtime 검증 수행.

## N. Bugs Found and Fixed

1. pgTAP has_table/has_index/has_pk의 unknown literal overload가 schema 대신 table/description으로 해석: expected true, actual false. 설명 인자를 추가해 overload 명시. 해당 신규 SQL test 수정.
2. 중첩 SELECT 인자 안의 data-modifying CTE: expected 0, actual SQL syntax error. CTE를 top-level로 변경. 신규 SQL test 수정.
3. generated pace 기대값: expected 42501, actual 400/428C9. 실제 generated-column 보호를 정확히 assert; 일반 보호 column은 42501 유지. 신규 API test 수정.
4. running 없는 빈 stack에서 schema 노출로 PostgREST schema-cache 실패. 초기 public-only 시작 후 migration 적용 뒤 local authenticator pgrst.db_schemas 설정 및 reload notification으로 running 노출.
5. Mac IPv4 54321은 다른 로컬 Perfect HTTP 응답, IPv6 loopback은 Kong/GoTrue 정상. IPv6 endpoint로 실제 테스트 통과. CLI health 404로 --ignore-health-check 사용; SQL/API 직접검증으로 기능 입증. 기존 서버는 건드리지 않음.
6. 초기화가 완료되기 전에 임시 mirror directory를 배치하여 재시작 시 CLI가 첫 old mirror를 실행하고 두 번째에서 42P01로 실패함. 요청의 local replay 금지 위반을 명시함. 원본/Production 변경 없음. 이후 mirror를 startup 경로 밖에 보존하고 빈 stack 완료 -> synthetic baseline/history -> bundle 배치 -> CLI gate -> 신규 migration 순서로 재실행. 최종 성공 환경에는 기존 SQL replay가 없고 synthetic history만 있음.
7. rollback 최소 fixture에 auth.uid 누락으로 목표 failure 전에 실패. auth.uid 최소 stub 추가 후 목표 transaction-end 22012와 rollback 검증 성공.

신규 running migration 자체의 runtime 버그는 발견되지 않아 SQL 수정 없음.

## O. Files Changed

이번 단계: supabase/tests/running_core_v1.test.sql, supabase/tests/running_api_integration.mjs 보강; docs/running-core-v1.md 및 이 결과 문서 갱신; today workspace disposable-checkout-consistency.md 추가. temp runner/config/bundle/log/backups/CLI 설치는 /private/tmp/running-disposable-20261002-02에 한정. 백업 비교: 기존 32 files byte-identical; 수정 차이는 허용된 신규 test 두 개(문서 갱신 전 기준)뿐. user tracked diff는 최초와 동일.

## P. Remaining Risks

medical checkout은 여전히 96 commits 뒤이며 사용자 변경 보존 상태. 현재 main 기반의 안전한 정본 조정은 다음 단계 필요. Production pre-flight에서 최신 history/권한/schema 노출/버전 확인 필요. synthetic fixture는 모든 Production 설정을 재현하지 않음. shared project Auth admin trust boundary, 기존 Gemini key exposure, 미구현 HealthKit/Auth UI/cloud sync/Storage는 기존 제한. API Contract test 현재 해당 Mac workspace의 절대 경로를 사용하므로 다른 checkout에서는 import/fixture 경로 조정 필요. Docker network exposure는 CLI 기본값 0.0.0.0이며 실제 credential 요청은 loopback만 사용. 초기 mirror replay 실수 때문에 검증 절차 재사용 시 startup 완료 전 bundle 배치 금지 guard가 필요.

## Q. Production Readiness

**READY FOR PRODUCTION PRE-FLIGHT**. 로컬 migration/DB/RLS/API/contract/rollback 통과. 실제 Production 적용 준비 완료 또는 배포 승인으로 해석하지 않음.

## R. Recommended Next Step

먼저 이 diff와 검증 증거를 code review. 사용자 파일을 보존한 현재 main 기반의 정본 checkout 조정 계획 수립. 이후 별도 승인 범위에서 Production read-only pre-flight: 최신 history, 대상 hash, pending 신규 migration 하나, backup/rollback plan, running API 노출/권한 및 공유 Auth 경계를 확인. 현재 단계에서는 Production 실행하지 않음.

## S. Change Confirmation

Production DB/설정/credential 사용 없음. Git branch 변경/commit/push/PR/Actions/Vercel 변경 없음. GitHub는 GET 조회만. 기존 medical 앱/원본 migration/RLS 수정 없음. Docker 실행 및 temp CLI 설치/local DB changes 있음. 실패한 초기 disposable mirror replay 있음(N 참조); 최종 검증 run은 신규 migration만 실행. 토큰 사용량: 이번 단계 약 25,000–40,000 tokens 추정(실측 아님).

## Complete pgTAP assertions

```text
ok 1 - Schema running should exist
 ok 2 - Only five core tables
 ok 3 - running.profiles exists
 ok 4 - running.shoes exists
 ok 5 - running.workouts exists
 ok 6 - running.workout_shoes exists
 ok 7 - running.import_batches exists
 ok 8 - medical definitions unchanged
 ok 9 - anon has no schema access
 ok 10 - service role has no schema access
 ok 11 - authenticated schema access
 ok 12 - service has no table privileges: import_batches
 ok 13 - service has no table privileges: profiles
 ok 14 - service has no table privileges: shoes
 ok 15 - service has no table privileges: workout_shoes
 ok 16 - service has no table privileges: workouts
 ok 17 - all tables have RLS
 ok 18 - four policies per table
 ok 19 - UPDATE checks both old and new rows
 ok 20 - no SECURITY DEFINER functions
 ok 21 - audit trigger not client callable
 ok 22 - service cannot execute validator
 ok 23 - revision INSERT restricted
 ok 24 - revision UPDATE restricted
 ok 25 - audit INSERT restricted
 ok 26 - external identity immutable
 ok 27 - ownership immutable
 ok 28 - generated pace restricted
 ok 29 - link PK immutable; delete and insert instead
 ok 30 - workouts_user_started_idx exists
 ok 31 - workout_shoes_user_shoe_idx exists
 ok 32 - import_batches_user_started_idx exists
 ok 33 - link primary key exists
 ok 34 - DB overrides even privileged insert audit value
 ok 35 - active pace calculated
 ok 36 - unknown distance pace NULL
 ok 37 - zero distance pace NULL
 ok 38 - zero duration rejected
 ok 39 - elapsed tolerance enforced
 ok 40 - NaN rejected
 ok 41 - negative distance rejected
 ok 42 - negative calories rejected
 ok 43 - HR order enforced
 ok 44 - zero HR rejected
 ok 45 - equal dates rejected
 ok 46 - duration basis restricted
 ok 47 - source slug restricted
 ok 48 - running only
 ok 49 - HealthKit mismatch rejected
 ok 50 - UUID type validation
 ok 51 - device allowlist
 ok 52 - device string size
 ok 53 - metadata allowlist
 ok 54 - metadata scalar validation
 ok 55 - canonical metadata size limited
 ok 56 - HR method enum
 ok 57 - ownership FK even without RLS
 ok 58 - duplicate import rejected
 ok 59 - completed counts required
 ok 60 - valid completed batch
 ok 61 - A only sees own workout
 ok 62 - A cannot update B
 ok 63 - A cannot delete B
 ok 64 - A cannot insert B
 ok 65 - client cannot change revision
 ok 66 - client cannot change audit
 ok 67 - client cannot change identity
 ok 68 - allowed metric update
 ok 69 - revision incremented by DB
 ok 70 - own FK allowed
 ok 71 - inactive profile hides business rows
 ok 72 - inactive insert denied
 ok 73 - membership withdrawal cascades through linked records
 ok 74 - withdrawal preserves Auth account
 ok 75 - withdrawal removes links
 ok 76 - service running denied
 ok 77 - medical service article read
 ok 78 - medical service collector write
 ok 79 - medical service alert write
 ok 80 - anon running denied
 ok 81 - medical public article read
 ok 82 - medical runs remain private
 ok 83 - medical definitions still unchanged
 1..83
```
