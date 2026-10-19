# 최종 CLI 수동 검증

2026-10-19, 최종 소스에서 실제 Node CLI를 별도 프로세스로 실행했다. 종료 코드 0.

- provision: 전용 PostgreSQL 17.6 생성.
- 기본 모드: DRY_RUN, 적용 없음.
- 20261016014502: COMMIT_CONFIRMED, 이력 5개.
- 20261016035115: COMMIT_CONFIRMED, 이력 6개.
- 20261019041429: COMMIT_CONFIRMED, 이력 7개.
- 마지막 버전 재실행: 종료 코드 1, ALREADY_APPLIED.
- cleanup: CLEANED.

실제 식별 증거: container `e613e676200d7d31e165842216a55f13eb0ac29aad8017034612fd77da974fee`, system identifier `7698275042347786282`, DB OID `16384`, server_version_num `170006`, DB `medical_mb006_ledger`, Unix socket, port 5432, network `none`, project `synthetic-local-only`.

감사 원본 보존 위치: `/var/folders/xk/7j9jfccs3w90_vx9sfnwqnn80000gn/T/mb006-ledger-qpsGqs`. 컨테이너와 합성 DB는 제거했으며 descriptor/audit는 증거로 보존했다.
