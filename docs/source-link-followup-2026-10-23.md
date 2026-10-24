# 원문 링크 후속 작업 — 2026-10-23

## 범위와 baseline

main `506688a49a0b86a0872ed5222176836103643b97` 기준.
PR #71/#73/#75/#79 병합을 확인했다. 원래 로컬 수정은 보존하고 별도 checkout에서 작업했다.
운영 DB는 SELECT만 수행했다. Backfill, Migration, 수동 Collector/Actions 실행,
운영 설정 변경, Production 직접 배포, 자동 Merge는 하지 않았다.

## 1. 운영 화면 검증

고객이 연결된 Chrome 창에서 정상 로그인한 후 검증했다. 인증값을 추출하지 않았다.

| 항목 | 관찰 | 결과 |
|---|---|---|
| 운영 KDCA 링크 클릭 | 313024 새 탭에서 원래 공지 제목·본문 확인 | PASS |
| 최근 KDCA 공식 원문 | 공식 목록의 313024/313014/313013과 별도 익명 탭 본문 제목 일치 | PASS |
| 운영 NHIS 링크 클릭 | 2026년 11월 요양급여비용 지급예정일 안내, 공식 WebSquare 상세 본문 확인 | PASS |
| e-평가 안내 | 390px에서 제목 전체·기관 경로·직접 이동 제약 설명 확인 | PASS |
| COMWEL/HURB/자보 안내 | 운영 저장 공지를 제목 검색해 각각 올바른 기관 안내·홈페이지 경로 확인 | PASS |
| 제목 복사 | 실제 버튼 클릭 후 성공 안내 표시, 모달 유지 | PASS |
| ESC/포커스 | 모달 닫힘, 원래 안내 버튼으로 포커스 복귀 | PASS |
| 화면 경계 | 자보 안내창 390/768/1024/1440px 모두 경계 안, 가로 넘침 없음 | PASS |
| Clipboard 권한 거부 | 이번 브라우저에서는 성공 경로만 관찰. 기존 단위 테스트로 거부 경로 확인 | 실환경 미검증 |
| 실제 터치/물리 iPhone·iPad/Safari | Chromium viewport 변경이며 navigator.maxTouchPoints=0 | 미검증 |

공개 기관 페이지 조회는 수집기 실행과 구분했다. KDCA는 실제 목록의 `jf_viewArtcl`에 있는
ID만 사용했다. HTTP 200만으로 성공 판정하지 않았다.

## 2. 과거 KDCA 복구

운영 SELECT: KDCA 40행 = NEW 31 + DELETED 9. NEW 중 source_detail_url 있음 17,
NULL 14. NULL 14 중 2건(312844/312845)은 이미 #71 표시 매핑으로 지원된다.
최신 3회 Collector 기록은 KDCA OK, 최신 metadata 기록은 updated=1/unchanged=9,
conflict=0/failed=0이다. 전체 run은 다른 출처 문제로 DEGRADED이므로 전체 정상으로 해석하지 않는다.

공식 목록 6페이지/60행을 읽고, 2026-09-22~10-06의 과거 원문 19건을 별도 탭에서 대조했다.
그중 현재 비삭제 NULL 행에 해당하는 미지원 12건만 기존 표시 매핑에 추가한다.

| DB id | 공식 ID | 공지 식별 제목 |
|---:|---:|---|
| 8475 | 312835 | 65세 이상 어르신 국가예방접종 다음주부터 순차적 시작 |
| 8271 | 312829 | 결핵예방법 국회 본회의 통과 |
| 8272 | 312828 | 예방접종관리법 국회 본회의 통과 |
| 8273 | 312806 | 국가건강정보포털 건강정보 인공지능 활용 정비 |
| 8274 | 312807 | 여행건강알림e 안내 |
| 7315 | 312800 | 국가예방접종 백신 전주기 관리 강화 |
| 7615 | 312816 | 만성질환 관리 확대 |
| 7616 | 312801 | 제2차 국가손상관리위원회 개최 |
| 6811 | 312729 | 유엔총회 팬데믹 예방·대비·대응 국제 공조 |
| 6812 | 312724 | 추석 명절 가정 내 안전사고 주의 |
| 6813 | 312721 | 한국인 확장성 심근병증 맞춤형 환자관리 |
| 6814 | 312720 | 초등학교·중학교 입학생 필수예방접종 완료 |

공식 상세 경로는 `https://www.kdca.go.kr/bbs/kdca/42/<공식 ID>/artclView.do`.
전체 원제목은 fixture와 resolver에 보존한다. 원문 312829는 목록/DB 제목의 공백 두 개가
상세 화면에서는 한 개로 표시된다. 동일 목록 행의 ID, 제목의 공백 정규화 일치,
날짜 2026.10.01 및 본문을 확인했다. 코드에서는 공백 정규화를 하지 않고 DB의 정확한
검색 제목만 허용한다. 한 공백으로 바뀐 검색 제목은 안내를 유지하는 회귀 테스트를 추가했다.

### 선택한 해결

기존 sourceLinks.ts의 VERIFIED_KDCA_NOTICES 3건을 15건으로 확장한다.
기존 출처/HTTPS host/게시판/query/전체 제목 검증, metadata 우선순위는 그대로 둔다.
article.url/id/hash/status/related_links/source_detail_url을 수정하지 않는다.
미확인 제목, 유사 제목, 다른 게시판, 중복·추가 query는 기존 안내를 유지한다.
새 공지는 #75 metadata 경로를 계속 사용하고, 삭제 행은 복구하지 않는다.

이 12건의 화면 복구에는 DB Backfill이 필요 없다. NULL 필드 자체를 채우려는 별도 요구가
있을 때만 기존 writer와 같은 id/url/source/title/hash/status/date + NULL 조건으로
검증된 매핑을 적용하는 별도 승인 절차를 검토한다. 자동 재수집이나 제목 추론은 하지 않는다.

## 3. Collector 장애 조사

관찰 대상: 자동 실행 39893278650 (2026-10-23 12:07 KST 시작),
39872223880 (2026-10-23 08:30 KST 시작). 재실행하지 않았다.

| 출처 | 확인된 사실 | 미확인 부분 / 후속 조치 |
|---|---|---|
| DailyMedi | Python 3.9.25/OpenSSL 3.0.13/requests 2.32.5/urllib3 2.6.3. SSLZeroReturnError, connection_closed. 상세 941651은 재시도로 성공, 941654 및 section22 목록 page9는 3회 소진. 직전 실행도 반복 | 서버/중간 장비/출발 IP 중 종료 주체는 미확정. 인증서 오류로 단정하거나 TLS 검증을 끄지 않는다. 원 운영 네트워크의 TLS 진단과 기관 측 확인 후 transport 수정 여부 결정 |
| 심평원 업무포탈 | 자보알림방 클릭을 MainFrame_Inspect 계열 overlay가 가로막고 30초 timeout. 최초 수집 함수 전체가 실패해 source_health의 '심평원 e-평가'로 기록됨 | e-평가 평가알림방과 다른 수집 함수다. 이번 공개 익명 브라우저에서는 HIRA 앱이 빈 shell로 남아 overlay 닫기 재현을 완료하지 못함. 강제 클릭/임의 API 대신 공식 닫기 UI 확인 후 별도 수정 |
| 국가법령정보센터 | LAW API returned an unexpected response. 코드상 200 JSON 후 최상위/ LawSearch / law 배열의 형태 검사 중 하나가 실패 | 응답 구조를 구분할 로그가 없어 원인 확정 불가. 인증값/응답본문/법령명 출력 없이 shape만 구분하는 진단을 별도 제안. 운영 키로 요청하거나 Collector를 수동 실행하지 않음 |

즉시 원인과 최종 root cause를 구분한다. 위 오류를 우회하는 TLS·재시도·수집·삭제 정책
변경은 이 PR에 포함하지 않는다. 열린 PR #54는 여전히 Collector/LAW와 겹치므로
해당 후속 수정은 작업 소유권과 범위를 조율한 뒤 별도 PR로 진행해야 한다.

## 검증 / rollback

- 수정 전: 실제 12개 과거 fixture의 resolver 테스트가 모두 기관 안내를 반환하며 실패.
- 수정 후: frontend 240/240 PASS. 실제 SourceLink 렌더링도 15개 fixture를 사용한다.
- TypeScript, ESLint, production build PASS. 로컬 가짜 Supabase URL/키만 사용.
- Collector 상세 URL/파서 오프라인 테스트 48/48, lifecycle 4/4 PASS. 수집기 실행 없음.
- 최초 sandbox 실행은 로컬 테스트 서버 bind EPERM 및 Next 생성 타입 부재로 실패.
  허용된 로컬 실행과 production build 후 type check로 재검증했다.
- 코드 변경은 resolver의 검증된 상수, fixture 및 회귀 테스트뿐이다.
- rollback은 이 frontend PR revert. 데이터/schema rollback은 필요 없다.

검증 자료: 로컬 `production-qa.json`, `kdca-official-list.json`, `kdca-past-details.json`,
`kdca-latest.json`, 안내창 screenshot. 인증값/쿠키/raw HAR는 저장하지 않았다.
CI/Preview 결과는 PR 생성 후 별도로 확인한다. 자동 Merge하지 않는다.
