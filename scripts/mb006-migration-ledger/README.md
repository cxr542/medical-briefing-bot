# MB-006 Phase 4: 로컬 원자적 Migration Ledger 도구

운영 실행 기능이 없는 검증 전용 도구다. macOS의 로컬 Docker Desktop과 기존 `postgres:17.6-alpine` 이미지, Node.js가 필요하다. 새 npm 의존성이나 설치·이미지 pull은 수행하지 않는다.

운영 DSN·host·project·password·token 인자를 받지 않는다. `.env`를 읽지 않으며 DATABASE_URL/PGHOST/DOCKER_HOST 등 기존 접속 환경을 Docker child에 전달하지 않는다. Docker는 로컬 Unix socket을 명시한다. 운영 Supabase와 연결하거나 Supabase CLI push/reset/repair를 실행하는 코드가 없다.

## 사용 방법

저장소 Git root에서 실행한다. 아래 provision은 **새 격리 컨테이너 및 합성 DB 생성**이고, apply는 그 컨테이너 안의 SQL만 실행한다.

```sh
node scripts/mb006-migration-ledger/cli.mjs --mode provision
```

출력의 `descriptor` 경로를 아래 `<descriptor>`에 사용한다. descriptor는 0600의 새 임시 파일이며 DB 비밀번호를 담지 않는다. `audit.jsonl`은 같은 디렉터리에 생성된다.

```sh
node scripts/mb006-migration-ledger/cli.mjs --descriptor '<descriptor>' --version 20261016014502
node scripts/mb006-migration-ledger/cli.mjs --mode apply --descriptor '<descriptor>' --version 20261016014502
node scripts/mb006-migration-ledger/cli.mjs --mode apply --descriptor '<descriptor>' --version 20261016035115
node scripts/mb006-migration-ledger/cli.mjs --mode apply --descriptor '<descriptor>' --version 20261019041429
node scripts/mb006-migration-ledger/cli.mjs --mode cleanup --descriptor '<descriptor>'
```

기본 모드는 validate/DRY_RUN이다. checksum·파일 경계·격리·ledger schema·기존 이력·지원 적용 prefix/순서 및 단계별 테이블/함수·RLS/권한·충돌 코드를 검사하며 Migration DDL을 실행하지 않는다. SQL 실행의 성공을 예측하는 일반 SQL dry-run 기능은 아니다. 원본 Migration의 guard도 apply transaction에서 검증한다. 모드/옵션·버전은 whitelist이며 URL·force·production 우회 옵션은 없다.

cleanup은 descriptor의 격리 증거를 다시 확인하고 해당 컨테이너와 공유되지 않은 소유 volume만 제거한다. 컨테이너가 정지/변조되어 증거 확인에 실패하면 자동 삭제하지 않는다. CLI의 audit/descriptor는 검토 증거로 남는다. 테스트 harness는 JSON 증거를 복사한 뒤 자신이 만든 임시 descriptor 디렉터리까지 정리한다.

## 격리 및 서버 식별

- 새 랜덤 이름·nonce label·정확한 container ID·image ID를 확인한다.
- network=none, host 포트/host bind 없음, TCP listen_addresses=''를 요구한다.
- `docker exec psql -h /var/run/postgresql -p 5432`만 사용한다.
- 실제 DB 이름 `medical_mb006_ledger`, PostgreSQL17, port5432, inet_server_addr=NULL, control-system identifier, database OID, DB nonce를 대조한다.
- 실행 transaction 안에서 서버/nonce/OID/ledger 상태를 다시 검사한다.
- descriptor 문자열이나 localhost 호스트명만으로 격리를 인정하지 않는다. descriptor를 위조해도 Docker·실제 서버 증거가 일치해야 한다.

이 통제는 우발적인 운영 접근을 방지한다. 로컬 Docker daemon 자체를 장악한 공격자를 격리하는 sandbox를 제공한다는 뜻은 아니다. 로컬 Docker 관리자 권한과 설치된 image/client는 신뢰 경계다.

## SQL 경계와 원자성

지원하는 파일은 최신 main의 검증된 3개이며 `manifest.mjs`의 SHA-256을 고정한다. 경로와 버전을 임의로 교체할 수 없으며 source를 한 번 읽고 checksum 확인한 in-memory 본문을 사용한다. 원본 Migration 파일은 수정하지 않는다.

`sql-boundaries.mjs`의 lexer는 SQL의 문자열·doubled quotes·E string escape·quoted identifier·dollar body·line comment·nested block comment를 구분해 **top-level statement**를 나눈다. 정확한 첫 BEGIN과 마지막 COMMIT만 경계로 인정하고, 본문에 있는 top-level transaction control 및 psql meta command는 거부한다. 경계 제거를 정규식 치환으로 하지 않는다.

이것은 임의 PostgreSQL 문법 전체를 해석하는 범용 parser가 아니다. 고정 checksum의 현재 파일 3개에만 허용되는 lexical 검증 전략이다. 파일이 바뀌면 즉시 checksum 오류로 멈추며 manifest 갱신은 새 검토와 실제 PG 테스트가 필요하다. 함수/DO dollar body 안의 BEGIN/END나 COMMIT 문자열은 변경하지 않는다.

실행 transaction은 다음 순서다:

1. BEGIN, local timeout/search_path/application_name 설정.
2. `pg_try_advisory_xact_lock(6006004)`. 획득 실패 시 즉시 거부.
3. 서버 식별과 전체 예상 ledger를 같은 transaction에서 재확인.
4. 기존 외곽 BEGIN/COMMIT을 분리한 원본 본문 실행.
5. 원본 전체 SQL을 statements 배열로 보관하고 version/name/created_by/checksum idempotency_key INSERT.
6. 기존 4개 전체 합성 행이 그대로인지 확인 후 COMMIT.

DDL·ledger INSERT 어느 쪽이든 실패하면 psql ON_ERROR_STOP으로 연결이 종료되며 열린 transaction이 rollback된다. 세 파일을 하나의 transaction으로 묶는 기능은 없다. 파일별 성공분은 남는다.

실행 오류나 COMMIT 응답 유실 시 도구는 `FAILED_RECONCILE_BEFORE_RETRY`를 기록하고 자동 재시도하지 않는다. 새 validate/ledger·객체 검토로 실제 commit 여부부터 확인한다. audit 파일 실패와 DB commit은 다른 실패 영역이므로 DB 상태 확인 전 재실행하면 안 된다. 성공은 COMMIT 후 ledger 재조회까지 통과한 경우만 `COMMIT_CONFIRMED`다.

## 이력 호환성과 합성 baseline

2026-10-19 운영에서 SELECT metadata로 확인한 ledger를 재현한다:

| 순서 | column | 타입 | nullable/default |
|---|---|---|---|
| 1 | version | text | NOT NULL / 없음, PK |
| 2 | statements | text[] | NULL 허용 / 없음 |
| 3 | name | text | NULL 허용 / 없음 |
| 4 | created_by | text | NULL 허용 / 없음 |
| 5 | idempotency_key | text | NULL 허용 / 없음, UNIQUE |
| 6 | rollback | text[] | NULL 허용 / 없음 |

owner postgres, relacl NULL, RLS/FORCE false, PK/UNIQUE 인덱스 2개다. 실제 과거 statement/created_by 데이터는 복제하지 않는다. 4개 version/name만 실제 목록과 같고 나머지는 합성 NULL이다. 새 행은 원본 source·DB role·`mb006:<version>:sha256:<hash>`를 기록한다. 별도 SHA column을 추가하지 않는다.

기존 전체 customer_auth Migration 2개를 적용해 validator/RPC/table/trigger 계약을 구성하고 합성 관리자·세션을 만든다. 기사/collector_runs는 최소 sentinel, collector_alert_state는 기존 Migration 구조를 재사용한다. 실제 고객 정보와 실제 Collector 실행은 사용하지 않는다.

## 테스트

```sh
node --test tests/mb006-migration-ledger/atomic.test.mjs
```

T01~T18은 실제 PostgreSQL17에서 각각 새 격리 컨테이너를 만든다. P01/P02는 lexer 경계 테스트다. 결과 위치는 `EVIDENCE_DIRECTORY`로 출력한다. 필요하면 로컬 증거 디렉터리만 지정한다:

```sh
MB006_LEDGER_EVIDENCE_DIR=/private/tmp/mb006-ledger-evidence \
  node --test tests/mb006-migration-ledger/atomic.test.mjs
```

검증 범위는 정상/7개 이력, 중복·역순·경합·lock 거부, event trigger SQL 실패, ledger trigger INSERT 실패, COMMIT 전 실제 backend 종료, 체크섬/기존객체/운영입력 거부, 기존 auth/Collector 보존이다. 이미 있는 원본 Migration을 바꾸거나 실패를 skip하지 않는다.

이 도구는 **운영용 배포 runner가 아니다**. 운영 백업·복원 실증, 이력 정합성 승인, hosted 권한·접속·변경창 및 별도 운영용 실행 경계 검토가 남는다. 운영 연결 옵션을 덧붙여 전용 검증 도구를 운영에 전용하지 않는다. [검증 보고서](../../docs/mb006-atomic-ledger/REPORT.md)를 확인한다.
