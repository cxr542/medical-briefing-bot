# MB-006 Phase 4 보존 및 Phase 5 운영 백업 사전 점검

2026-10-19 KST. **Phase 4 보존·재현 PASS. 운영 백업 실행 준비도 BLOCKED. 운영 Migration 적용 준비도 BLOCKED.**

증거 수준: VERIFIED=직접 관찰/실행, INFERRED=코드·공식 문서에서 도출, UNVERIFIED=실제 환경에서 아직 확인하지 못함. 운영 백업·복원은 이번 범위 밖이며 실행하지 않았다.

## A. Executive Summary

Phase 4 원본 worktree를 유지하고 별도 보존 브랜치에 도구/테스트/README/검증 보고서/체크리스트를 정리했다. 실제 PostgreSQL17.6 재현은 T01–T18+추가2개, 총20 PASS다. 운영 실행 차단을 완화하지 않았고 원본 Migration/앱 코드는 변경하지 않았다. Draft PR의 최종 URL/commit/상태는 [PR 결과](PR-RESULT.md)에 기록한다.

Free에서도 수동 논리 백업 경로를 검토할 수 있지만 현재 direct DNS 실패, 실제 Session Pooler endpoint·DB 자격증명/TLS 접속 미확인, 보관·암호화·민감자료 복원 범위 미승인으로 실행 준비는 BLOCKED다. 운영 복구점이 존재한다고 가정하지 않는다. [Runbook](RUNBOOK.md)과 [보안 설계](SECURITY.md)는 후속 승인용이며 실제 실행 승인이 아니다.

## B. Baseline

| 항목 | 관찰 |
|---|---|
| 최신 origin/main | fetch 확인, 4ac3a5481fd23db9e9744ae8a445318018808668 |
| 원래 사용자 checkout | fix/collector-schedule-offset, HEAD548ee2c88905b40d6831352ddfcc405d0f7f8cec; 기존 수정/미추적 파일 보존 |
| Phase 4 원본 | `/private/tmp/mb006-atomic-ledger-20261019`, codex/cxr542/mb006-atomic-ledger, 파일 실제 존재 |
| 보존 worktree/branch | `/private/tmp/mb006-preserve-backup-preflight-20261019`, chore/mb006-atomic-ledger-validation |
| main 충돌 | 시작 시 동일 SHA. 새 경로만 추가, 기존 추적 파일 수정 없음 |
| GitHub 인증 | 로컬 keyring의 cxr542, repository ADMIN 확인. sandbox 내부 인증 실패 표시는 네트워크 허용 재확인에서 해소. 토큰 값은 사용·공개하지 않음 |
| 운영 project | healthcare-Briefing / kkcvglldsoxglfjqnsga / ACTIVE_HEALTHY / Free |

Production Vercel 설정/배포를 변경하거나 이번 작업에서 재검증하지 않았다. 선행 v3 보고서의 배포 상태를 이번의 새 배포 검증으로 해석하지 않는다.

## C. Phase 4 Artifact Inventory

원본 source/test/README와 보존본은 바이트 단위 일치한다. 모듈7개(manifest/sql-boundaries/target/local/engine/objects/cli), README, atomic.test.mjs, REPORT/APPROVAL-CHECKLIST/SELF-REVIEW/CLI-EVIDENCE/EVIDENCE/TEST-OUTPUT를 보존했다. EVIDENCE는 합성 데이터만 포함한다. 원본 보고서의 개인 홈 경로 한 곳은 보존본에서 `<original-checkout>`으로 가렸다. 원래 파일은 수정하지 않았다. gate는 개인 경로를 제외한 GATE-REVIEW 요약을 추가했다.

장기 증거 보존을 위해 재현 T01–T18의 전체 audit 포함 JSON18개와 TEST-REPRODUCTION.txt를 명시적으로 추가했다. 이들은 비식별 합성 시험 증거이며 운영 로그나 backup archive가 아니다. 원본 `.omo`, descriptor, 개인 경로의 CLI audit, 외부 임시 로그/백업/credential은 stage하지 않는다. [추적 파일 inventory](INVENTORY.md)를 참조한다.

Phase 5 추가물은 이 보고서, METADATA/SECURITY/RUNBOOK/INVENTORY 및 PR-RESULT 문서다. 기존 앱 인증/Collector/API/UI, Workflow, 의존성·lockfile, 기존 Migration은 그대로다.

## D. Security Review

검토한 공개 파일에서 실제 credential/개인정보/운영 데이터/백업 파일을 발견하지 못했다. 합성 UUID·nonce·systemID·SHA256 및 project 식별자는 인증 비밀이 아니다. service_role 브라우저 노출·새 운영 연결 옵션·.env 로딩·production bypass는 추가하지 않았다. default DRY_RUN, 고정 Docker socket, sanitized child env, 실제 network none/DB 물리 식별 검증이 유지된다.

문서의 백업 명령은 미실행 템플릿이며 암호/URL을 직접 인자에 넣지 않는다. source credential과 restore 환경을 분리한다. 새 의존성/유료 서비스/설정 설치 없음. LSP는 기존 미설치 상태를 유지하고 Node 구문·실제 PG 테스트를 사용한다. 검토 기록과 scan 범위/한계는 [보존 점검](PRESERVATION-REVIEW.md)에 남긴다.

## E. Test Reproduction

실행: `MB006_LEDGER_EVIDENCE_DIR=/private/tmp/mb006-preservation-test-evidence-20261019 node --test tests/mb006-migration-ledger/atomic.test.mjs`.

**VERIFIED: 20 PASS /0 FAIL /0 SKIP, 52.933초**, PG170006. 정상·중복·역순·SQL 실패·ledger 실패·COMMIT 전 연결 종료·같은/다른 Migration 경합·lock 거부·checksum/객체/운영 입력·인증/Collector 보존·최종7건을 재현했다. [실행 출력](../mb006-atomic-ledger/TEST-REPRODUCTION.txt), [개별 증거](../mb006-atomic-ledger/evidence/reproduction/).

macOS, Node25.9.0, Docker Desktop, 기존 캐시 postgres:17.6-alpine이 필요하다. pg_dump/psql17.6은 image 안에 있다. npm 의존성0, 자동 이미지 pull/설치 없음. Linux Docker socket 또는 임의 DB를 지원하지 않는다. 새 환경에서는 동일 이미지 확보/Node 호환 확인이 필요하다. 소스/테스트 byte equality를 확인했으므로 동일 코드 재현 증거다. 기존 앱 CI 전체를 로컬에서 반복하지 않았다.

## F. GitHub Draft PR

제목: `chore(mb-006): preserve validated atomic migration tooling`. 브랜치: `chore/mb006-atomic-ledger-validation`, base main. commit/push 및 Draft PR은 이번 요청에서 승인된 보존 작업이다. 최종 URL, commit 및 자동 CI 관찰은 [PR-RESULT.md](PR-RESULT.md)에 기록한다. PR merge/auto-merge 설정/Actions 수동 실행은 하지 않는다. push/PR에 따른 기존 자동 검사는 수동 실행과 구분한다.

## G. Production Connection Assessment

[실제 메타데이터](METADATA.md) 참조. connector postgres 세션은 TLSv1.3이며 SQL17.6을 확인했다. 이것은 로컬 pg_dump credential/접속 증거가 아니다. 로컬 direct DNS는 ENOTFOUND, 인증 시도 없음. Session Pooler host는 UNVERIFIED. 캐시 Supabase CLI2.81.3은 미인증, PATH에 psql/pg_dump 없음. 기존 image pg_dump17.6의 버전만 확인했다.

제품상 Direct5432는 Free에서 IPv6, Session Pooler5432는 IPv4 대안이다. Transaction Pooler6543는 session state/준비문 등에 제약이 있어 백업 경로로 선택하지 않는다. 실제 pooler 주소는 Dashboard Connect에서 확인해야 한다. 인증은 DB 역할/기존 비밀번호이며 connector OAuth나 service_role API key로 대체하지 않는다. sslmode=verify-full과 승인된 CA로 host를 검증해야 한다. 현재 프로젝트의 SSL 강제 설정/로컬 TLS 인증 성공은 UNVERIFIED다. [연결 방식](https://supabase.com/docs/guides/database/connecting-to-postgres), [PSQL TLS 예시](https://supabase.com/docs/guides/database/psql).

## H. Backup Capability

VERIFIED metadata: postgres는 LOGIN/BYPASSRLS true, SUPERUSER false. public/customer_auth/auth/storage/supabase_migrations에 USAGE 있고 대상 테이블 SELECT 및 시퀀스 SELECT 누락0이다. support는 현재 없다. 함수·RLS·GRANT·index·sequence는 논리 archive가 표현할 수 있지만 실제 dump/restore 성공은 UNVERIFIED다. managed role·extension 소유권과 Vault 의존성은 별도 검토해야 한다. 권한 보유와 backup 성공은 별개다.

단일 pg_dump는 일관 snapshot을 제공하지만 역할 등 cluster global을 포함하지 않는다. schema 선택은 외부 의존성·large object를 자동 보장하지 않는다. 첫 시도는 단일 연결과 제한된 lock wait를 계획하고 DDL 변경창을 피한다. 성능/크기/완료 시간은 실제 실행 전 UNVERIFIED다. [PostgreSQL17 pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

## I. Backup Scope

| 범위 | 논리 백업/격리 복원 | 관리형 DB 백업 | 별도 필요 |
|---|---|---|---|
| A DB schema/data/functions/RLS/ACL/index/sequence | 선택한 범위에 포함 가능; 실제 실증 필요 | 제공 복구점·서비스 범위에 따라 DB 복원 | 역할/extension/소유권 매핑 |
| B Supabase Auth | managed auth와 custom customer_auth 구분; 단순 app archive에 auth 자동 포함 가정 금지 | DB 내 객체 복원 범위 | JWT/provider/SMTP/기존 token 동작 별도 |
| C Storage metadata | 승인 schema 포함 여부 확인 | DB metadata | 파일과 시점 일치 |
| D Storage 실제 파일 | pg_dump 미포함 | DB 백업 미포함 | private 객체 export/hash/보존/복원 정책 |
| E env/외부 서비스 | 미포함 | 전체 외부 설정 복원 보장 없음 | secret manager 및 설정 recovery 별도 승인 |
| F GitHub/Vercel | 미포함 | 미포함 | repository/branch rules/배포·환경 구성 inventory |

Storage 현재 파일 존재/건수를 이번에 조회하지 않았다. 선행 v3는 buckets0을 기록했지만 현재 상태를 새로 보장하지 않는다. 비어 있더라도 첨부 기능 활성화 전 별도 blob 백업 정책이 필요하다. Supabase CLI는 managed schema/role을 필터링하므로 default dump를 전체 복구본으로 간주하지 않는다. ledger도 명시 포함한다. [공식 CLI 복원](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [self-hosted 복원 범위](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

## J. Free Plan Constraints

실제 organization free/tier_free 확인. 공식 pricing상 Free에는 자동 백업/PITR이 포함되지 않는다. Free에는 정기 논리 export를 권고하며, 관리형 daily restore point가 있다고 전제할 수 없다. 현재 backup 목록/관리형 복원 가능 항목/보존기간은 UNVERIFIED다. PITR은 유료 플랜 add-on이며 활성화하지 않았다. [백업 문서](https://supabase.com/docs/guides/platform/backups).

Free DB500MB/egress5GB 등 요금제 한도와 로컬 pg_dump archive 크기 제한은 다른 개념이다. pg_dump 자체의 별도 Free archive 최대 크기는 공식 문서에서 확인되지 않아 UNVERIFIED로 남긴다. 현재 catalog DB 크기는19,246,227 bytes지만 dump 크기를 추정하지 않는다. 저장 공간·암호화/복원 여유·egress 잔량은 실행 전 확인한다. [요금제](https://supabase.com/pricing).

Free 저활동7일에 pause될 수 있어 실행 전 ACTIVE 상태를 확인한다. pause된 복구 화면/만료 시점은 프로젝트별로 재확인하며 pause를 백업 전략으로 사용하지 않는다. 오래된 90일 changelog와 최신 문서가 혼재하므로 특정 restore 유예기간은 이 프로젝트에서 UNVERIFIED다. [Project Pausing](https://supabase.com/docs/guides/platform/free-project-pausing). 유료 서비스/IPv4 add-on/새 프로젝트를 생성하지 않았다.

## K. Backup Security Design

[SECURITY.md](SECURITY.md)에 저장 위치, 스트림 암호화, 키 분리,0700/0600, 파일명, 로그, Git/동기화 차단, 보존·안전 삭제를 제안했다. 실제 저장 장치/동기화/디스크 암호화/키 복구는 UNVERIFIED다. pg_dump는 암호화 도구가 아니며 age 설치/recipient 승인도 필요하다. Git/PR/공개 클라우드/공유·불명확한 동기화 위치에는 백업을 저장하지 않는다. 이번에 실제 백업 파일·비밀 파일·키를 생성하지 않았다.

## L. Isolated Restore Plan

별도 PG17, network none/Unix socket/포트 없음, 합성과 분리한 암호화 대상에만 복원한다. 실제 자료를 외부로 전송하지 않는다. 역할은 기본 NOLOGIN, 외부 service/cron/worker/mail 비활성, source credential 미전달이다. table/schema/행 수/function/security/GRANT/RLS/index/constraint/sequence/ledger/auth/Collector를 snapshot 기준 대조한다. 고객 행 내용은 공개 로그로 출력하지 않는다.

현재 vanilla image는 supabase_vault 등 운영 extension/baseline을 모두 보장하지 않는다. 동일 major만으로 호환 PASS가 아니다. 승인된 image 및 managed role/extension 버전이 없으면 해당 범위 복원을 중단한다. --no-owner/--no-acl로 권한을 제거하고 보존 PASS라 하지 않는다. managed schema 중복은 원본 archive 수정/오류 무시가 아니라 검토한 TOC·baseline 매핑으로 다룬다. 실제 운영 자료 복원은 미실행이다.

## M. Migration Ledger Compatibility

실제6컬럼/PK/UNIQUE/인덱스2/owner/ACL/RLS와 도구 fixture가 일치한다. 기존4버전 유지, 신규3버전 충돌 없음. postgres INSERT metadata=true, service_role=false이며 실제 쓰기 성공은 UNVERIFIED다. SQL과 신규 이력 INSERT의 원자성은 합성 PG 테스트에서 VERIFIED이며 운영 실행에서는 UNVERIFIED다. 기존4행의 선택 필드 원문을 읽거나 수정하지 않았다.

checksum은 pinned SHA256 및 idempotency_key에 기록한다. CLI 구조와 맞는 ledger shape지만 CLI가 이 custom idempotency key를 지속 보존하거나 신규 runner 기록을 실제 승인한다는 보장은 없다. 향후 CLI버전·원격/로컬 version/name crosswalk·statement 배열 roundtrip을 격리 복사에서 검증해야 한다. 기존 version 매핑 차이와 auth migration 이력 누락은 해결됐다고 선언하지 않는다. repair/db push를 실행하지 않았다. 로컬 합성 LEGACY=NULL fixture를 운영에 전용할 수 없으며 안전장치를 풀어서는 안 된다.

## N. Phase 5 Runbook

[RUNBOOK.md](RUNBOOK.md) STEP1 범위→2 보관/암호화→3 별도승인→4 논리백업→5 무결성→6 격리준비→7 복원→8 대조→9 평가→10 보존/삭제를 작성했다. 각 단계의 조건/방법/시간/성공/중단/복구/위험/승인을 명시했다. 시간 미측정은 UNVERIFIED다. 현 작업에서는 STEP1/2의 설계까지만 수행하며 실제 백업 준비물 구성도 하지 않았다.

## O. Remaining Blockers

1. 실제 Dashboard Connect의 Session Pooler 정보 또는 direct DNS/IPv6 문제 해결, 기존 DB credential 및 verify-full 접속 증거.
2. 저장 장치/암호화·키 복구·동기화 제외·접근자·보존 기간 확정과 승인.
3. managed Auth/Storage metadata/blob/Vault/role·extension 포함·제외 및 RPO/RTO 결정.
4. 운영 백업 생성과 민감자료 로컬 격리 복원의 별도 승인, 이후 실제 성공 증거.
5. 운영 Migration용 실행 경계와 기존 이력 crosswalk, 쓰기 성공/원자성의 승인된 검증. Phase4 로컬 안전장치 완화 금지.

## P. Final Verdict

| 항목 | 판정 | 증거 수준 / 한계 |
|---|---|---|
| 1 Phase4 도구 보존 | PASS | VERIFIED, 원본 유지/별도 branch/추적 inventory |
| 2 테스트 재현성 | PASS | VERIFIED,20/20 PG17.6 |
| 3 GitHub Draft PR 준비 | PASS | 검토·로컬 commit 가능; 최종 생성 사실은 PR-RESULT 참조 |
| 4 운영 DB 접속 가능성 | BLOCKED | connector metadata는 VERIFIED, 로컬 direct DNS 실패/pooler·인증 UNVERIFIED |
| 5 운영 백업 권한 | CONDITIONAL | catalog 읽기 권한 VERIFIED, 실제 dump UNVERIFIED |
| 6 백업 범위 | CONDITIONAL | INFERRED 설계, managed/blob 포함 범위 승인 필요 |
| 7 Free 제약 | PASS | 조직 VERIFIED/공식 지원 확인, 실제 복구점 UNVERIFIED |
| 8 백업 파일 보안 | CONDITIONAL | INFERRED 설계, 실제 장치/키 미확인 |
| 9 격리 복원 계획 | CONDITIONAL | INFERRED 설계, 운영 archive 실증 없음 |
| 10 Migration 이력 정합성 | CONDITIONAL | 구조/4버전/신규 충돌 없음 VERIFIED; 전체 local/remote crosswalk 미완료 |
| 11 Migration 이력 쓰기 권한 | CONDITIONAL | metadata VERIFIED, 실제 INSERT UNVERIFIED |
| 12 운영 백업 실행 준비도 | BLOCKED | 접속·보관·범위·별도 승인 미완료 |
| 13 운영 Migration 적용 준비도 | BLOCKED | 운영 backup/restore 증거 및 별도 실행 승인 없음 |

운영 환경 변경 없음. 운영 DB는 connector SELECT metadata만 접속했고 로컬 DB 인증 접속은 하지 못했다. 운영 데이터 내용 조회/다운로드 없음(허용된 ledger version/name 제외). 백업/복원/Migration/이력 변경/Secrets/Storage/Vercel 변경/Collector/Actions 수동 실행/기능 활성화/배포/PR merge 없음.

## Q. Codex Usage Report

계정 전체 조회값이며 이 작업만의 비용이 아니다.

| 항목 | 값 |
|---|---|
| 정확한 사용 모델 ID | 조회 불가 |
| 작업 토큰 사용량/잔여량 | 조회 불가 |
| 컨텍스트 사용량/잔여 비율 | 조회 불가 |
| 주간 사용/잔여 | 25% /75% |
| 주간 초기화 | 2026-10-25 08:16:10 KST |
| 5시간 사용/잔여/초기화 | 조회 불가 |
| 초기화권 남은 횟수 | 3회, 사용하지 않음 |
| 초기화권 초기화/다음 지급 날짜 | 조회 불가 |

지급/만료(KST): 2026-09-23 04:19:25→2026-10-23 04:19:25; 2026-09-30 02:30:32→2026-10-30 02:30:32; 2026-10-08 06:26:10→2026-11-07 06:26:10.
