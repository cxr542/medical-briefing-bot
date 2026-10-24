# KDCA 검증된 상세 링크 표시 복구

## Baseline

- main: `ef7c685bb99e649acb2013e21d3c2daebf8e4f08`.
- PR #70: MERGED, merge commit `345bfa7ed9c8cfec9611ed684701956c89663d5a`, main 포함 확인.
- 열린 PR #54는 Collector/DailyMedi, #55는 LAW 보안 변경. 이번 변경은 frontend 파일만 포함하여 파일 겹침 없음.
- 사용자 원래 작업 공간의 수정·미추적 파일은 건드리지 않고 별도 managed worktree에서 작업.

## 읽기 전용 조사

`collector_parsers.py::parse_kdca_press_release_html`은 상세 path나 onclick의 숫자를
찾지만, 공식 목록의 `href="javascript:jf_viewArtcl('kdca', '42', '312868')"`를
해석하지 못한다. 따라서 제목 검색 목록 URL을 생성한다. URL과 제목으로 content_hash를 만든다.

`collector.py::track_states`는 url로 기존 행을 매핑하고 content_hash 등의 변화를 비교한다.
`save_to_supabase`는 `on_conflict='url'`로 upsert한다. `collector_lifecycle.py`는 수집된
출처 중 불완전하지 않은 출처에 대해 없어진 URL을 삭제 후보로 판정한다.
수집 URL만 상세 URL로 바꾸면 기존 기사와 다른 identity가 되어 NEW/DELETED 전이가 가능하다.

Supabase `public.articles` 실제 스키마 확인: id PK, url UNIQUE, source/title/content_hash/status,
published_date, related_links JSONB, is_merged 등. 별도 공식 상세 URL 컬럼은 없다.
SELECT 결과 (2026-10-10 조회 시점):

| URL 유형 | 상태 | 행 수 |
|---|---|---:|
| 제목 검색 목록 | NEW | 15 |
| 제목 검색 목록 | DELETED | 6 |
| 빈 URL/RSS 오류 | DELETED | 1 |

검색 URL 날짜 범위는 2026-09-22~2026-10-07 KST. KDCA source의 related_links 항목은 0개.
우선 대상 3건은 각각 검색 URL/NEW로 저장되어 있으며 related_links는 null이다.
운영 DB에는 SELECT만 수행했다. 수집기 실행 및 DB/설정 변경은 하지 않았다.

## 공식 링크 검증

[공식 보도자료 목록](https://www.kdca.go.kr/bbs/kdca/42/artclList.do)의 실제 href와
[공식 목록 JS](https://www.kdca.go.kr/Web-home/fnct/bbs/JW_bbs_table/js/artclList.js)의
`jf_viewArtcl` 이동을 대조했다. 각 실제 목록 링크를 클릭하여 도착 URL을 기록하고,
별도 익명 프로필의 새 탭에서 그 URL을 열어 전체 제목과 본문을 확인했다.

| ID / 공식 URL | 확인 제목 |
|---|---|
| [312868](https://www.kdca.go.kr/bbs/kdca/42/312868/artclView.do) | [10.8.목.조간] 임신당뇨병 산모의 자녀, 당뇨병 위험 최대 4배 이상 높아 |
| [312844](https://www.kdca.go.kr/bbs/kdca/42/312844/artclView.do) | 「아이치-나고야 하계 아시아경기대회」 감염병 예방은 마지막까지 빈틈없이!(10.6.화) |
| [312845](https://www.kdca.go.kr/bbs/kdca/42/312845/artclView.do) | 질병관리청, 건전한 조직문화 조성을 위한 ‘청렴라이브(LIVE)’ 개최(10.2.금) |

3건 모두 DIRECT, 로그인 없이 제목/본문 확인, 최종 URL 동일. ID를 추측해 만든 주소가 아니다.
기관 사이트 삭제·제목 수정은 추후 재검증 대상이다. Chromium iPhone UA/touch 에뮬레이션에서도
첫 공지 본문이 보였으나 기관 페이지 layout viewport는 1440px였다. 실제 Safari/물리 기기는 미검증.

## A/B 비교와 적용 범위

| 전략 | 효과 | 위험 / 판단 |
|---|---|---|
| A: 기존 resolver의 표시 href만 매핑 | 기존 url/hash/id/status 유지, DB 쓰기·schema 변경 불필요 | 검증 목록의 3건만 적용. 이번 PR 채택 |
| A: 별도 저장 필드/related_links에 메타데이터 저장 | 향후 일반화 가능 | 별도 필드 없음. related_links는 다른 기사 구조이며 저장/UPDATE 판정 변경 필요. 이번 PR 미채택 |
| B: Collector 상세 URL 생성 변경 | 신규 공지 자동 상세화 가능 | URL UNIQUE/중복/Lifecycle 및 hash 전환 설계 필요. 별도 PR로 분리 |

`sourceLinks.ts`는 등록된 KDCA 출처·HTTPS origin·정확한 게시판 path를 확인하고,
page=1, srchColumn=title, srchWrd=전체 제목의 세 query만 허용한다.
공지 제목과 검색 제목, 검증 목록 제목이 정확히 같아야 상세 href를 반환한다.
다른 제목, 중복 query, 추가 query/hash, 미검증 공지는 기존 기관 안내를 유지한다.
이 매핑은 일반적인 제목 검색 추론기가 아니며 미래 공지의 ID를 계산하지 않는다.
기존 정상 상세 URL 및 NHIS 로직은 그대로 유지한다.

실제 기존 3행은 UI 배포만으로 복구된다. 나머지 검색 URL 18행 및 앞으로 수집되는
미검증 공지는 자동 복구되지 않는다. 변경된 제목/주소 역시 안전하게 안내로 남는다.
모든 화면은 공통 SourceLink/resolveSourceLink를 사용하며 related record도 자체 source/title/url로 판정한다.

## 검증

- Frontend 143/143 테스트 통과. 저장 id/url/hash/status/related_links 불변 및 잘못된 제목 매핑 거부 검사 포함.
- 기존 NHIS 6건, HIRA/COMWEL/HURB 안내, 정상 기관 링크 회귀 테스트 유지.
- Collector offline unittest: 143 tests, OK, native smoke 1건 skipped. 수집기 수동 실행 없음.
- ESLint, TypeScript 통과. 환경변수 없는 첫 build는 supabaseUrl 누락으로 실패.
  로컬 GET-only fixture URL/가짜 키를 명시한 production build는 통과.
- 로컬 production 화면에서 KDCA 표·기관 카드 각각 3개 상세 href와 `_blank`/noopener 확인.
  미검증 KDCA는 기존 모달/ESC 닫기 확인. NHIS 상세 링크 유지.
- 로컬 390px/touch5 화면 확인. 실제 물리 기기 검증은 수행하지 않음.
- 외부 요청 검증은 공지 본문까지 확인했으며 HTTP 200만으로 PASS 처리하지 않음.

## 후속 PR / 롤백

이번 PR은 검증한 3건의 표시 복구이며 Backfill은 필요 없다. 저장 데이터 identity를 바꾸지 않는다.
전체 신규 KDCA 자동 복구는 별도 metadata 계약 또는 URL identity 전환 PR이 필요하다.
후속 설계는 official ID 보존, legacy identity 매핑, collision 및 부분 수집 삭제 보호,
related_links 연결, 재수집 idempotence를 먼저 테스트해야 한다. 운영 Backfill은 별도 승인 대상으로 남긴다.

롤백은 이번 frontend PR revert. DB rollback은 불필요하다. 자동 Merge/Production 배포는 하지 않는다.
