# MB-006 Phase 4 — Atomic Migration Ledger Validation

검증일: 2026-10-19 KST. 결과: 로컬 격리 검증 PASS, 운영 Migration 승인 BLOCKED.

## 1. Executive Summary

기존 세 Migration을 수정하지 않고 SQL 변경과 해당 ledger INSERT를 동일 PostgreSQL 트랜잭션에서 처리하는 로컬 전용 도구를 구현했다. PostgreSQL 17.6에서 T01–T18 및 경계 검사 2개, 총 20개가 통과했다. 별도 CLI 프로세스의 기본 검증 모드, 전체 순차 적용, 중복 거부, 정리도 통과했다. 운영 실행 기능은 제공하지 않는다.

## 2. Baseline

- Repository: cxr542/medical-briefing-bot.
- 최신 조회 origin/main: `4ac3a5481fd23db9e9744ae8a445318018808668`.
- 원래 checkout: `<original-checkout>`, branch `fix/collector-schedule-offset`, HEAD `548ee2c88905b40d6831352ddfcc405d0f7f8cec`.
- 격리 worktree: `/private/tmp/mb006-atomic-ledger-20261019`, branch `codex/cxr542/mb006-atomic-ledger`, 위 origin/main 기준.
- 기존 .DS_Store, frontend 변경/미추적 파일, .omo 및 manual QA 파일을 보존했다. 원래 checkout을 변경하지 않았다.
- 선행 v3/staging REPORT를 읽고 참조했다. 이번 결과는 해당 보고서의 운영 backup/restore 조건을 해소하지 않는다.
- 추가 파일: scripts/mb006-migration-ledger의 manifest, sql-boundaries, target, local, engine, objects, cli 모듈 및 README; tests/mb006-migration-ledger/atomic.test.mjs; 이 문서 디렉터리의 보고서/체크리스트/증거. 기존 추적 파일 수정 없음. commit/push/PR 없음.

## 3. Environment Safety

로컬 Docker daemon Unix socket만 사용한다. 새 PostgreSQL 17.6 컨테이너는 network=none, 게시 포트 없음, host bind 없음, listen_addresses=''이다. 실제 container/image/nonce/DB 이름/OID/system identifier/server version/Unix socket 상태를 검사한다. descriptor는 0600이며 symlink/추가 키를 거부한다. PG/DOCKER 연결 환경변수나 .env를 자동 로딩하지 않는다. DSN/운영 project/host/우회 옵션 입력을 받지 않는다. production project `kkcvglldsoxglfjqnsga`에는 ledger 메타데이터 SELECT만 수행했다. 운영 DDL/DML, Secrets, 배포, Collector 실행 없음.

## 4. Migration Ledger Schema

운영 메타데이터를 직접 읽어 확인했다. `supabase_migrations.schema_migrations`: version text NOT NULL PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text UNIQUE, rollback text[]. version 외 nullable, 모두 default 없음. 제약은 schema_migrations_pkey 및 schema_migrations_idempotency_key_key, unique btree index 두 개, owner postgres, ACL NULL, RLS/FORCE false.

postgres의 SELECT/INSERT/UPDATE/DELETE는 허용되지만 service_role은 모두 false이다. anon/authenticated SELECT도 false이다. API service_role 자격증명은 ledger writer 권한을 대신하지 않는다.

기존 버전 `20260928064906`, `20260929063328`, `20261007041102`, `20261012043225`의 실제 version/name을 합성 환경에 재현했다. 선택 필드의 운영 값은 조회/복사하지 않고 NULL로 구성했다. 각 실행 전후 합성 기존 행 전체가 동일함을 검증했다.

## 5. Atomic Execution Design

기본 CLI는 validate/DRY_RUN이다. 명시적 apply만 격리 descriptor를 사용한다. manifest에 고정한 세 버전/원본 SHA-256/순서를 검사한다. 원본을 한 번 읽고 검증한 메모리 내용을 사용한다. 각 파일마다 BEGIN, timeout 설정, 대상 재확인 및 잠금, 예상 ledger snapshot 확인, SQL 본문, ledger INSERT, 기존 행 보존 확인, COMMIT을 한 psql 연결에서 실행한다. statements에는 외부 경계를 포함한 원본 SQL을 보관한다.

원자성 단위는 Migration 한 개다. 세 파일 전체를 한 트랜잭션으로 묶지 않으므로 후속 실패 시 앞서 성공한 버전은 유지된다. COMMIT 후 상태 재조회 또는 감사 저장에 실패하면 FAILED_RECONCILE_BEFORE_RETRY로 중단하며 자동 재시도하지 않는다.

## 6. Transaction Boundary Verification

원본 foundation/attachments/PT409의 BEGIN/COMMIT envelope를 lexical scanner로 확인한다. 문자열, escaped/doubled quote, dollar body, 중첩 주석, identifier를 구분한 최상위 statement offset만 사용한다. 내부 최상위 transaction 제어문, psql metacommand, 닫히지 않은 token을 거부한다. 함수 내부 BEGIN/END와 문자열 COMMIT은 보존한다. 정규식 일괄 제거를 사용하지 않았다. 세 원본 SHA-256은 manifest/README에 고정했고 원본 Migration 파일은 변경하지 않았다. 이 scanner는 세 pinned source용이며 범용 PostgreSQL parser가 아니다.

## 7. Concurrency Control

동일 DB에서 pg_try_advisory_xact_lock(6006004)을 획득한 뒤 ledger snapshot과 적용 순서를 재확인한다. 잠금 실패는 즉시 거부하고 transaction 종료 시 잠금을 해제한다. lock/statement/idle transaction timeout을 설정했다. T09는 동일 버전 및 선행 버전이 아직 commit되지 않은 후속 버전 경쟁을 검사했다. T10은 독립 세션이 실제 잠금을 보유한 상황을 검증했다. 이 잠금은 동일 계약을 따르는 도구 간 보호이며 별도 DBA 작업 전체를 차단하지 않는다.

## 8. Test Results

최종 명령: `MB006_LEDGER_EVIDENCE_DIR=/private/tmp/mb006-atomic-ledger-evidence-reviewed-20261019 node --test tests/mb006-migration-ledger/atomic.test.mjs`.

실제 결과: 20 PASS, 0 FAIL, 0 SKIP, 51.978초. PostgreSQL server_version_num 170006. [원본 출력](TEST-OUTPUT.txt), [사례별 DB 식별·관찰·감사 증거](EVIDENCE.md), [최종 CLI 검증](CLI-EVIDENCE.md).

| 사례 | 검증 | 결과 |
|---|---|---|
| T01 | 기본 dry run 및 정상 적용 | PASS |
| T02 | 원본 SQL/체크섬/이력 기록 | PASS |
| T03 | 기존 4건 보존 | PASS |
| T04 | 동일 버전 재실행 거부 | PASS |
| T05 | 역순 거부 | PASS |
| T06 | DDL 중간 실패 | PASS |
| T07 | ledger INSERT 실패 | PASS |
| T08 | COMMIT 전 실제 backend 종료 | PASS |
| T09 | 동일·서로 다른 버전 동시 실행 | PASS |
| T10 | 독립 세션 잠금 획득 실패 | PASS |
| T11 | 체크섬 불일치 | PASS |
| T12 | 예상 밖 기존 객체 | PASS |
| T13 | 운영 식별값/위조 물리 DB 식별 거부 | PASS |
| T14 | 잘못된 DSN/우회 옵션 및 환경변수 무시 | PASS |
| T15 | 인증 객체/합성 사용자·세션 보존 | PASS |
| T16 | Collector 객체/합성 데이터 보존 | PASS |
| T17 | 세 버전 순차 적용 | PASS |
| T18 | 최종 7건 및 객체/RLS/ledger drift 거부 | PASS |
| P01/P02 | quoted SQL 보존 및 transaction 제어문 거부 | PASS |

새 도구는 built-in Node만 사용하며 애플리케이션/의존성/CI를 변경하지 않았다. 사용자 지시에 따라 기존 CI를 불필요하게 반복하지 않았다. 신규 GitHub CI 실행/PR 생성 없음.

## 9. Failure Injection Evidence

T06 CREATE INDEX event trigger 실패와 T07 ledger BEFORE INSERT 오류에서 support schema와 신규 이력 모두 사라졌다. T08은 ledger trigger의 pg_sleep 중 pg_stat_activity로 진행을 확인하고 pg_terminate_backend를 실행했다. 이 경우도 schema/신규 이력이 함께 rollback됐다. T06 실패 주입 해제 후 재시도는 정상 성공했다. 실패의 DB 상태와 audit는 EVIDENCE 및 원본 JSON에 기록했다.

## 10. Existing Data Preservation

기존 ledger 4행, 실제 기존 인증 migration에서 생성한 함수의 security/config/ACL 및 합성 admin/session, 합성 articles/collector_runs와 기존 collector_alert_state 객체/행을 비교했다. 고객 데이터는 사용하지 않았다. 이는 합성 fixture에서의 보존 증거이며 운영 전체 데이터 보존을 직접 입증하는 것은 아니다. 원본 SQL/앱/Collector 코드를 수정하지 않았다. 이번 실행의 컨테이너와 전용 볼륨/합성 DB만 정리했다. 네트워크는 별도 생성하지 않았다. 감사 증거와 보고서는 보존했다.

## 11. Security Review

대상 안전성은 운영 문자열 차단뿐 아니라 실제 Docker 격리와 PG 물리 식별을 함께 확인한다. shell interpolation 없이 execFile, sanitized 환경, 고정 socket/DB 계정을 사용한다. 인증정보를 입력/출력하지 않는다. 적용 ledger prefix와 support 테이블/RLS/FORCE/함수/권한 계약을 검사한다. 실행 중 source 재읽기와 자동 재시도를 피한다. 자체 코드 검토는 SELF-REVIEW.md, 별도 읽기 전용 gate 결과는 `GATE-REVIEW.md`에 보존한다.

## 12. Remaining Risks

- 로컬 전용이며 운영 연결/권한/실제 backup·restore는 검증하지 않았다.
- lexical 검증은 고정된 세 파일에 제한된다. 새 SQL을 자동 수용하지 않는다.
- 객체 검증은 명시된 구조/권한 계약이며 전체 DB drift 검증이 아니다.
- 파일 감사와 DB commit은 별도 atomic domain이다. commit 결과 불확실 시 수동 상태 대조가 필요하다.
- 합성 legacy 선택 필드와 최소 Collector fixture는 운영 데이터 전체를 복제하지 않는다.
- 로컬 Docker daemon/사용자 자체의 악의적 변경은 이 도구의 신뢰 경계 밖이다.

## 13. Production Readiness

[승인 체크리스트](APPROVAL-CHECKLIST.md) 참조. 운영 backup 확보 및 복원 입증, 기존 이력과 원본 파일 매핑, 실제 ledger 쓰기 권한, 운영 대상 식별 및 변경 절차, lock/timeout/실패 복구 절차를 별도로 승인해야 한다. 이번 로컬 전용 도구에 운영 DSN 허용 옵션을 추가하는 것은 승인 범위 밖이다. 기능 활성화/Storage/검사 서비스 준비도는 이 작업으로 변경되지 않는다.

## 14. Final Verdict

| 항목 | 판정 | 근거/조건 |
|---|---|---|
| 이력 테이블 구조 호환성 | PASS | 실제 운영 메타데이터와 합성 schema 일치 |
| Migration 실행 원자성 | PASS | 코드 경계 분석 + T06–T08 |
| 실패 시 롤백 | PASS | 실제 실패/연결 종료 시 DDL 및 ledger rollback |
| 중복 실행 방지 | PASS | T04/T09 및 CLI |
| 동시 실행 안전성 | PASS | T09/T10, 동일 실행 계약 범위 |
| 체크섬 검증 | PASS | 고정 원본 및 T11 |
| 기존 이력 보존 | PASS | 합성 기존 행 비교 T03 |
| 인증 객체 보존 | PASS | 합성 PG fixture T15 |
| Collector 객체 보존 | PASS | 합성 PG fixture T16 |
| 운영 환경 차단 | PASS | 실제 격리 증거 + T13/T14 |
| 운영 적용 도구 준비도 | CONDITIONAL | 로컬 atomic 전략 검증 완료, production executor는 의도적으로 미제공 |
| 운영 Migration 승인 가능 여부 | BLOCKED | 운영 backup/restore·권한·절차 및 별도 승인 미완료 |

로컬 검증 PASS는 운영 실행 또는 기능 활성화 승인이 아니다.

## 15. Codex Usage Report

사용량 조회 시점의 계정 전체 값이며 이 작업만의 사용량이 아니다.

| 항목 | 값 |
|---|---|
| 정확한 사용 모델 ID | 조회 불가 |
| 작업 토큰 사용량/잔여량 | 조회 불가 |
| 컨텍스트 사용량/잔여 비율 | 조회 불가 |
| 주간 한도 사용/잔여 | 23% / 77% |
| 주간 초기화 | 2026-10-25 08:16:11 KST |
| 5시간 사용/잔여/초기화 | 조회 불가 |
| 초기화권 남은 횟수 | 3회 |
| 초기화권 초기화 날짜 | 조회 불가 |

초기화권 지급/만료(KST): 2026-09-23 04:19:25 → 2026-10-23 04:19:25; 2026-09-30 02:30:32 → 2026-10-30 02:30:32; 2026-10-08 06:26:10 → 2026-11-07 06:26:10. 이번 작업에서 초기화권을 사용하지 않았다.
