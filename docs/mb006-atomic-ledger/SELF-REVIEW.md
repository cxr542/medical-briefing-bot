# 자체 코드 및 증거 검토

검토 범위: 새 scripts/mb006-migration-ledger 모듈, 자동 테스트, README, 증거. 운영 실행 승인은 범위 밖이다.

| 기준 | 코드 분석 | 관찰 증거 |
|---|---|---|
| 원자성 | 한 psql 세션의 BEGIN 안에 본문과 ledger INSERT 배치 | T06 SQL 실패, T07 INSERT 실패, T08 연결 종료 모두 DDL/이력 동시 롤백 |
| 경계 | 문자열/주석/dollar quote 구분 후 외부 경계만 제거, 내부 제어문 거부 | P01/P02, 세 원본 체크섬 일치 |
| 동시성 | transaction advisory lock 뒤 snapshot 재검사 | T09/T10 실제 별도 세션, 한 번만 성공/잠금 실패 거부 |
| 격리 | Docker network none, 포트/host bind 없음, socket 및 물리 DB 식별 재확인 | 모든 T01–T18 target, T13/T14 부정 입력 |
| 보존 | 기존 이력 snapshot 및 인증/Collector 합성 객체 비교 | T03/T15/T16 |
| 드리프트 | 적용 prefix와 객체/RLS/권한/함수 계약 검사 | T12/T18 |
| 실제 CLI | 파싱부터 provision/apply/cleanup까지 별도 프로세스 | CLI-EVIDENCE.md |

과적합 검토: 결과를 고정 문자열로 대신하지 않으며 실제 PostgreSQL의 schema/ledger/pg_stat_activity를 검증한다. 실패 주입은 event trigger, ledger trigger, pg_terminate_backend를 사용한다. 운영 fixture의 선택 필드는 NULL 합성이므로 운영 행 전체 복제 증거로 해석하지 않는다. T15/T16은 같은 통합 보존 assertion을 반복하는 소규모 중복이 있지만 서로 다른 요구사항의 관찰값을 검증한다. 테스트 삭제/skip/단언 약화 없음.

구조 검토: 새 의존성/추상 서비스/애플리케이션 변경 없이 CLI, 대상 검증, lexical scanner, 실행 엔진, 객체 검증, manifest, 로컬 fixture로 분리했다. 일반 SQL parser 또는 범용 Migration runner로 주장하지 않는다. 오류는 인증정보 유출 방지를 위해 일반화되며 운영 진단 도구를 대신하지 않는다.

잔여 한계: DB COMMIT과 파일 감사 기록은 같은 atomic domain이 아니다. 사후 검증/로그 오류는 commit 결과 불확실로 분류하고 자동 재시도를 금지한다. advisory lock은 같은 계약을 따르는 실행기만 직렬화한다. 임의 DBA 변경을 방어하거나 완전한 DB drift를 검증하지 않는다. 운영 backup/restore 및 별도 승인 절차는 미해결이다.
