# Phase 5 운영 백업 및 격리 복원 Runbook — 검토용, 미실행

이 문서는 실행 승인이 아니다. STEP 3 승인 전에는 dump, 운영 데이터 건수/행 조회, 파일 생성, 복원을 수행하지 않는다. Migration 실행·이력 repair·Storage/Secrets/배포 변경·Collector/Actions 실행·기능 활성화는 이 Runbook에도 포함하지 않는다. 기존 Phase 4 CLI는 합성 DB 전용이며 운영 백업/복원 도구로 재사용하지 않는다.

## 승인에 필요한 고정 정보

- Source: healthcare-Briefing, project `kkcvglldsoxglfjqnsga`, PostgreSQL17.6. 접속 service는 아직 구성하지 않았다.
- 읽기 전용 source 연결: Dashboard Connect에서 확인한 direct 또는 Session Pooler host/port/user, DB postgres, 서버 CA 및 sslmode=verify-full. Transaction Pooler는 제외한다.
- 담당자가 기존 승인 자격증명을 OS 비밀 저장소에서 사용한다. 비밀번호/URL을 채팅·명령행·환경 덤프·로그에 넣지 않는다. 0600 PGPASSFILE/PGSERVICEFILE을 잠금 해제한 암호화 볼륨 안에서 제한적으로 준비하는 방안이며 아직 파일을 만들지 않았다. 비밀번호 생성/재설정은 별도 승인 대상이다.
- 필수 범위: public, customer_auth, supabase_migrations. support는 현재 없으며 실행 직전 존재 여부를 재확인해 존재하면 포함한다. app archive의 외부 extension/function/role 의존성을 명시한다.
- managed auth/storage 데이터와 customization, Vault 및 extension 자료, Storage 파일은 별도 범위 결정이 필요하다. 제외된 범위가 있으면 전체 프로젝트 복구 PASS로 판정하지 않는다. 서로 연관된 별도 dump는 같은 exported snapshot을 공유하거나 불일치 가능성을 승인해야 한다.
- 대상은 새 전용 PostgreSQL17(동일 major, 호환 extension을 갖춘 고정 image). 합성 테스트 환경·기존 개발 컨테이너·운영과 공유하지 않는다. 기본 network=none, listen_addresses='', host port/bind 없음, 전용 암호화 저장소 사용. Docker Desktop 내부 volume의 실제 디스크 암호화까지 확인한다. 로컬 OS 관리자만 접근한다.
- 데이터 소유자/실행자, 백업 저장 위치, 암호화 키 소유자/복구자, 보존 기간, 성능 중단 임계값, 복원 범위/RPO/RTO를 명시적으로 승인해야 한다.

## STEP 1–10

시간은 예약 제안 또는 UNVERIFIED이며 실행 측정값이 아니다. 작은 DB라도 실제 dump/restore 시간을 보장하지 않는다.

| STEP | 실행 조건 / 방법 | 예상 시간 | 성공 기준 | 중단 조건 / 복구 | 보안 위험 / 승인 |
|---|---|---|---|---|---|
| 1 범위 확정 | 실행 담당자가 최신 schema/extension/role/설정 inventory와 복구 요구를 대조. app, managed Auth, Storage metadata/blob, 설정을 포함/제외로 명시 | 검토 30–60분 예약 제안 | 대상/의존성/제외 범위와 데이터 소유자 결정 | 빠진 의존성/책임자가 있으면 계획 수정, 운영 변화 없음 | 인증 hash·세션 포함 가능. 범위 승인 필요 |
| 2 보관·암호화 | SECURITY.md 기준으로 비동기화 암호화 볼륨/키 복구/0600·0700/여유 공간 확인. 기존 비밀로 verify-full 읽기 전용 세션만 확인 | 준비 30–60분 제안 | 승인 위치·키 복구 및 인증/TLS 확인 | 평문/동기화/잘못된 host·인증이면 중단. 부분 준비물만 담당자 확인 후 제거 | credential 노출 방지. 위치·키·접근자 승인 필요 |
| 3 실행 승인 | 이번 사전 점검과 확정 manifest, 성능 임계값, 저장/복원 계획을 제시하고 운영 백업 생성 및 민감자료의 로컬 격리 복원 범위를 승인받음 | 승인 일정 미정 | 명시적 승인 범위 기록 | 승인 없으면 이후 단계 금지 | 승인 전 파일 생성 금지. 별도 승인 필수 |
| 4 논리 백업 | 승인 source service와 pg_dump17 단일 custom archive 사용. 기본 app+ledger를 일관 snapshot으로 export. manifest에 승인한 managed 범위는 별도 또는 단일 snapshot에 포함. local encrypted volume으로 직접 스트림 암호화 | UNVERIFIED, 첫 실행 측정 | pg_dump/암호화 둘 다 exit0, 완성본과 승인 범위 일치 | 권한/DDL lock/부하 임계/동시 배포/네트워크 오류면 중단. partial 격리, 자동 retry 없음 | source는 읽기 부하와 ACCESS SHARE/DDL 경합. Step3 승인 범위 내에서만 |
| 5 무결성 | 암호문 SHA-256, 복호화/인증 검증, pg_restore --list TOC를 보호된 위치에서 검사. 목록은 AI 로그로 출력하지 않음 | UNVERIFIED | checksum/복호화/필수 객체 TOC 일치 | 손상/누락이면 완성본 아님. partial 보존·원인 확인 후 재생성 범위 재확인 | TOC/metadata도 제한 접근. Step3 범위에 포함 |
| 6 격리 준비 | 전용 image/systemID/DB OID/nonce/network=none/no ports/no host bind 및 저장 암호화를 확인. 외부 서비스·mailer·worker·cron·HTTP egress 차단. role는 원본 권한 manifest에 맞게 NOLOGIN으로 구성 | 30–60분 예약, image 준비 UNVERIFIED | source와 물리 식별이 다르고 합성 자원과도 분리, extension 버전 준비 | 운영 주소/공유 volume/extension 불일치면 복원 금지. 이번 전용 빈 자원만 확인 후 재생성 | 실제자료가 Docker VM에 남을 수 있음. Step3의 대상 승인 필요 |
| 7 격리 복원 | 검증된 암호문을 복호화 스트림으로 격리 DB의 pg_restore에 전달. --exit-on-error/단일 transaction 검토. 원본 ownership/ACL 유지에 필요한 역할·extension을 먼저 준비 | UNVERIFIED | 승인된 모든 객체/행 복원 성공, 오류 0 | 소유권/extension/trigger 오류면 중단. 오류를 무시하지 말고 새 빈 대상에서 계획 수정 후 재시도 | dump는 실행 가능한 SQL. network 차단 및 외부 실행 경로 검토 필수. 운영에 restore 금지 |
| 8 대조 | 동일 backup snapshot에 대응하는 schema/테이블 및 행 수, 함수 정의 hash/security/search_path/ACL, RLS/FORCE/policy, grant/default grant, index/constraint, sequence 값, ledger 전체, auth·Collector 객체 비교 | UNVERIFIED | 승인 범위에서 누락/차이 0 또는 사전 승인한 매핑만 존재 | 차이/객체 누락/권한 약화면 FAIL. 운영 SELECT snapshot 추가 수집은 승인 범위 확인 | 고객 행/credential을 보고서에 출력하지 않음. 건수·digest는 보호된 manifest, 공개 보고서는 판정만 |
| 9 복구 평가 | app DB/managed Auth/metadata/blob/외부 설정별 복구 범위와 실제 소요/RPO/RTO를 기록 | 평가 30–60분 제안 | 증거와 한계를 분리해 PASS/CONDITIONAL/BLOCKED | 파일·Vault·role 등 미복원 영역이 있으면 전체 복구 PASS 금지 | Migration/기능 활성화 승인을 의미하지 않음 |
| 10 보존·삭제 | 승인 기간 내 암호문 및 키를 분리 보존. 복원 컨테이너/volume/temp credential/부분 파일을 책임자가 식별해 정리. 만료 후 삭제 증거 기록 | UNVERIFIED | 보존본/복구키 접근 확인 또는 승인된 폐기 완료 | 공유 자원·보존 의무 불명확하면 자동 삭제 금지 | SSD overwrite를 안전 삭제로 가정하지 않음. 암호화 키 폐기와 잔존 사본 점검. 삭제는 승인 범위 필요 |

## 백업 명령 계약 — 문서 예시이며 실행하지 않음

host/port/user/password는 명령 인자로 직접 넣지 않고 승인된 libpq service 및 passfile로 구성한다. 아래 recipient는 공개키 별칭이며 아직 생성/승인되지 않았다. `age`, pg_dump, service, 디렉터리가 준비되지 않은 현재 상태에서는 실행할 수 없다.

```sh
set -o pipefail
umask 077
pg_dump --dbname='service=mb006_prod_backup' --format=custom \
  --schema=public --schema=customer_auth --schema=supabase_migrations \
  --lock-wait-timeout=5s \
  | age --recipients-file '<approved-public-recipient-file>' \
      --output '<approved-encrypted-volume>/mb006-prod-<UTC>-app-ledger.dump.age.partial'
```

아직 존재하지 않는 support를 무조건 인자로 넣지 않는다. large objects 및 schema 밖 의존성이 있으면 --schema 선택만으로 포함되지 않으므로 manifest에서 따로 다룬다. 위 예시는 app+ledger이며 managed Auth/storage/Vault/role/외부 설정을 백업했다는 뜻이 아니다. pipefail과 각 종료값을 확인하기 전 partial을 완성본으로 rename하지 않는다. stderr에도 SQL/객체명/개인정보가 있을 수 있으므로 보호된 로그로 보내고 공개 출력은 오류 코드만 남긴다. log 위치/스트림 처리 프로그램은 실행 단계에서 검토해야 한다.

Source credential은 backup client에만, 격리 restore client에는 source 주소/비밀을 전달하지 않는다. 복원용 DB 이름은 운영 postgres와 다른 `mb006_restore_review`처럼 고정하며 systemID/nonce로 실재 대상도 확인한다. network=none 대상에는 docker exec/Unix socket으로만 입력한다. 원본 archive는 수정하지 않고, role/TOC 매핑은 별도 검토 파일로 관리한다. --no-owner/--no-acl 또는 trigger 비활성화를 편의상 사용하고 권한 보존 PASS로 보고하지 않는다. 관리형 baseline 호환이 불가능하면 해당 범위를 BLOCKED로 남기고 새 설계를 승인받는다.
