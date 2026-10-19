# Phase 5 백업 보안 설계 — 미실행

백업은 고객 식별 정보, password hash, session 관련 값, 함수 본문을 포함할 수 있다. 지금은 실제 백업/복원/키·credential 생성/위치 생성을 수행하지 않는다.

| 항목 | 제안 / 승인 조건 |
|---|---|
| 저장 위치 | Git·tmp·Downloads·공유·동기화 폴더 밖의 전용 암호화 로컬 볼륨. 예: 승인된 외장 암호화 APFS의 `/Volumes/<approved-volume>/MB006/`. 실제 장치/암호화/자동동기화·백업 에이전트 대상 여부는 UNVERIFIED이며 승인 전 확인 |
| 파일 암호화 | pg_dump stdout을 age recipient 공개키 암호화에 직접 연결. 평문 dump는 디스크에 만들지 않음. 암호화 볼륨도 추가 요구. age 미설치이므로 도입/recipient fingerprint/복호화 실증은 후속 실행 전 준비 |
| 키 | 개인키는 dump와 분리한 기존 승인 secret manager/보호된 오프라인 매체. 실행자/복구자와 recovery 절차 승인. Git/채팅/환경 덤프 금지. 새 운영 key 생성/rotation 없음 |
| 권한 | 보호 볼륨 디렉터리0700, 파일0600, umask077, 개인 OS 계정만 접근. 그룹 공유/guest/원격 mount 금지 |
| 이름 | `mb006-prod-<UTC YYYYMMDDTHHMMSSZ>-<scope>-<nonce>.dump.age`, 생성 중 `.partial`. 고객명/사번/이메일/credential을 이름에 넣지 않음 |
| 로그 | row/SQL data/connection URL/env/token/password/TOC 원문 공개 금지. 보호된 상세 오류와 공개 오류 코드/판정 분리. 실행 도구의 stderr도 데이터로 취급 |
| Git | 백업·키·passfile·service·개인 manifest는 저장소 밖만 허용. stage는 경로 whitelist, diff 검사와 credential/backup 확장자 scan. .gitignore만 보안 경계로 삼지 않음 |
| 동기화 | iCloud/Dropbox/Drive/Time Machine/endpoint agent 대상 여부를 실제 확인. 불명확하면 사용 금지. 공개 클라우드/공유 폴더 금지 |
| 보존 | 제안: 검증 완료 후 7일 또는 승인된 변경 종료까지 중 더 필요한 기간; 최종 기간은 자료 소유자 승인. 법적/업무 보존 요구가 있으면 우선 확인. 자동 삭제 미설정 |
| 삭제 | 소유자 확인 후 dedicated restore volume/container·부분 파일·temp credential만 제거. SSD overwrite 보장 대신 암호화 키 폐기와 모든 복제본/스냅샷/백업 사본 정책 확인. 완전 삭제 증명은 UNVERIFIED |
| 격리 복원 | Docker VM 디스크/전용 데이터 volume의 암호화 및 접근도 확인. egress/worker/cron/mail 차단. 실제자료를 기존 합성 test 환경/외부 Supabase/CI에 전송하지 않음 |

다음 승인 요청은 이 표의 실제 값(장치/경로, key owner, 보존 기간, 접근자)과 backup scope/접속 경로를 확정한 뒤 한다. 이번 사전 점검 완료만으로 백업 실행을 승인받았다고 해석하지 않는다.
