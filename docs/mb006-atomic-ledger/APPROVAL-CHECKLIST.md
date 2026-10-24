# MB-006 운영 적용 전 승인 체크리스트

Phase 4 도구는 로컬 network=none 전용이다. 아래 항목을 통과해도 이 도구에 운영 접속 옵션을 추가하거나 운영 실행에 사용하지 않는다. 운영용 runner의 별도 설계·검토·승인이 필요하다.

| Gate | 현재 | 승인에 필요한 자료 |
|---|---|---|
| 고정 3개 SQL checksum/순서 | PASS (local) | manifest, T01/T11/T17 |
| 실제 ledger schema 호환 | PASS (확인 범위) | 운영 metadata:6 columns/PK/UNIQUE/index/owner/ACL/RLS, 합성 기존4행 |
| DDL+ledger 원자성 | PASS (local) | T06/T07/T08, 단일 connection/transaction |
| 중복·경합·lock 거부 | PASS (local) | T04/T05/T09/T10 |
| 기존 자료 보존 | PASS (synthetic) | T03/T15/T16. 운영 행을 복제하지 않았음 |
| 운영 접근 차단 | PASS (Phase4) | T13/T14, Docker+실제 server identity, URL/production override 없음 |
| 운영 백업·격리 복원 | BLOCKED | 실제 운영 archive 범위/보관·접속 승인과 복원 증거 |
| 과거 이력 처리 | CONDITIONAL | 기존4 version 보존, root/nested crosswalk·canonical 경계·CLI 운용 승인 |
| 운영 DB 접속/role/TLS | BLOCKED | 승인된 DB client/역할/접속경로. 현재 도구는 이를 제공하지 않음 |
| 운영 적용·감사·불확실 COMMIT 처리 | BLOCKED | 담당자·승인자·artifact 보관·timeout/중단정책·별도 운영용 executor 검토 |
| 운영 PostgreSQL/PostgREST/flag 상태 | CONDITIONAL | 실행 직전 fresh metadata·schema cache·기능 비활성 확인 |
| Storage provisioning | BLOCKED | 별도 승인·private bucket/RLS/실제 hosted 수용 |
| scanner/worker/보관·정리 | BLOCKED | 운영 환경·안전한 연결·서명/queue/감시·삭제정책 수용 |
| support/attachments 활성화 | BLOCKED | 각각 별도 명시 승인 |

운영 Migration과 활성화는 이번 Phase에서 승인되지 않았다. 실패 시 기본 복구는 transaction rollback 또는 성공분을 비활성 상태로 보존하는 것이다. 전체 운영 restore·이력 repair·데이터 삭제는 별도 승인한다.
