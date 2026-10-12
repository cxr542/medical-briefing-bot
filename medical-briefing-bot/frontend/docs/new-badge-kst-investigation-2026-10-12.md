# NEW 표시 / 날짜 불일치 조사 및 수정

조사일: 2026-10-12 KST. 운영 DB는 SELECT만 수행했다.

## A. Executive Summary

- ROOT CAUSE: PARTIAL (NEW 유지 및 브라우저 날짜 변환은 CONFIRMED;
  원문 게시일과 과거 25/33건의 정확한 원인은 미확정).
- 최초 조사 당시 main 및 Production 배포 SHA:
  `94d4e27b306b0bcc2c298ef572adbacf86e77636`.
- Production: `dpl_CiF6rn8GSJb4ko4hmAKS9eAtc93w`, READY, main 배포.
- 작업 중 main/Production이 `93d42d2d36a46513a4d8891b225011027899cbdc`
  (`dpl_64BiQuxiJ91mYnZgsbPAs6ybanhZ`, READY)로 변경되었다.
  최종 branch는 이 최신 main에 rebase하고 다시 검증했다.
- NEW POLICY: 정책 C. `status=NEW`이고 최초 저장 시각 `created_at`의 KST 날짜가
  선택 브리핑 날짜와 일치할 때만 화면 NEW. DB lifecycle은 변경하지 않는다.
- DATE ROOT CAUSE: DB timestamp를 브라우저 local calendar로 표시하여 날짜가 달라짐.
- DB MIGRATION: NOT REQUIRED. COLLECTOR IMPACT: NONE.

## B. Current NEW Contract

최초 조사 SHA의 `collector.py:656`의 `track_states()`는 현재 시각에서 7일 이내 **게시일**인
DB 기사만 조회하고 URL로 비교한다. 그 조회 집합에 URL이 없으면 NEW를 저장한다
(`:680`). 전체 DB에 없다는 의미와는 다르므로 오래된 기존 URL이 다시 NEW로
upsert되는 경우도 가능하다. 이 작업에서는 해당 lifecycle을 변경하지 않았다.

content_hash, 명시적으로 제공된 category/keywords/is_merged 값이 달라지면
UPDATE를 저장한다 (`:684`). 동일하면 upsert하지 않는다 (`:701`).
다음 날이라는 이유만으로 NEW나 UPDATE가 해제되지 않는다.

완전 수집된 출처의 기존 URL이 새 목록에서 누락되면 DELETED로 분류한다
(`:705`, `collector_lifecycle.py`). 이는 원문 삭제를 직접 검증한 상태가 아니다.
불완전 수집 출처와 이번에 수집되지 않은 출처는 이 비교에서 제외된다.
최신 main의 상세 URL 저장 기능도 검토했으며 위 lifecycle과 created_at 보존 계약은 같다.

수정 전 UI는 주요 공지/기관 모달/CSV에서 DB status를 그대로 사용했고,
selectedDate를 NEW 판정에 사용하지 않았다. NEW가 지속된다는 가설: **CONFIRMED**.

## C. Supabase Evidence

운영 프로젝트: `healthcare-Briefing` (`kkcvglldsoxglfjqnsga`).
`information_schema.columns`, `pg_trigger`, `pg_indexes`, articles를 읽기 전용 조회했다.

| 컬럼 | 타입 | 기본값 | nullable | 의미/기록 주체 |
| --- | --- | --- | --- | --- |
| published_date | timestamptz | 없음 | YES | Collector가 원문 게시일을 기록 |
| created_at | timestamptz | now() | YES | 첫 INSERT의 DB 시각 |
| status | varchar | NEW | YES | Collector의 lifecycle 상태 |
| updated_at | 없음 | — | — | 변경 시각을 알 수 없음 |
| first_seen_at | 없음 | — | — | 별도 최초 발견 시각 없음 |
| last_seen_at | 없음 | — | — | 마지막 확인 시각 없음 |
| source_detail_url | text | 없음 | YES | 작업 중 다른 PR에서 추가된 원문 링크 metadata; 최초 저장 시각 아님 |

articles의 사용자 trigger는 0개이며 URL UNIQUE 제약이 있다.
Collector 및 `comwel_only.py`의 신규/수정 payload는 created_at을 새로 생성하지 않는다.
삭제 payload는 읽어온 기존 created_at을 그대로 전달한다. URL 기준 PostgREST
upsert는 payload 컬럼만 UPDATE하므로 누락된 created_at은 보존된다.
[PostgREST v14 SQL 생성 코드](https://github.com/PostgREST/postgrest/blob/v14.0/src/PostgREST/Query/QueryBuilder.hs#L122)
(`iCols`에 대해서만 `DO UPDATE SET ... EXCLUDED` 생성)를 확인했다.

따라서 **현재 저장 경로의 URL별 최초 DB 저장 시각**으로 created_at을 사용 가능하다.
원문 최초 등장 시각이나 저장 실패 전 발견 시각은 아니다. nullable이며 DB에서
불변으로 강제하지 않으므로 향후 import/복원/작성 경로 변경 시 재검토해야 한다.
없거나 잘못된 값이면 NEW를 표시하지 않는다. 과거 모든 쓰기 이력을 검증한 것은 아니다.

조회 시 상태 분포: NEW 2,948건 / UPDATE 86건 / DELETED 1,350건.
모든 집합에서 created_at NULL 0건. NEW의 가장 오래된 created_at은
`2026-08-19T01:13:12.345870Z`로, 영속 NEW의 실제 존재도 확인했다.

문제 기사:

| 필드 | 운영 값 |
| --- | --- |
| id | 12687 |
| source | 심평원 e-평가 (평가알림방) |
| title | 「2029년 입원 시 상병(POA) 청구 정확도 평가」 변경 사항 안내 |
| url | https://aq.hira.or.kr/hira_aq/index.jsp#brdSno=2279 |
| published_date | 2026-10-07T15:00:00+00:00 |
| created_at | 2026-10-08T06:12:52.173377+00:00 |
| status | NEW |
| updated_at / first_seen_at / last_seen_at | 컬럼 없음 |

## D. Date Mismatch

`collector.py:807`는 regDt (`YYYY-MM-DD`)를 읽고, `:815`에서 자정 +09:00을
붙여 저장한다. DB 문제 기사는 KST `2026-10-08 00:00`, UTC `10/7 15:00`이다.
해당 parser 경로라면 regDt=10/8이 이 값으로 저장된다. 그러나 당시 raw 응답은
보관되어 있지 않아 원문 regDt의 직접 검증과 동일하지 않다.

원문 제목은 [공식 홈페이지 검색 결과](https://aq.hira.or.kr/)에서 확인했지만
게시일은 확인하지 못했다. 환경에서 원문 직접 접근이 제한되었고 검색 결과에도
날짜가 없었다. **원문 게시일: 미확인**, **DB KST 게시일: 10/8**,
**기존 화면: Seoul 10/8, UTC/Los Angeles 10/7**로 구분한다.

수정 전 `new Date(value).getFullYear()/getMonth()/getDate()`는 브라우저 local
시간을 사용했다. 같은 DB 값으로 10/7 ↔ 10/8 차이가 발생하는 경로는 확정했다.
고객 브라우저의 실제 시간대는 미확인이다. 변경 후 모든 날짜 표시/CSV는 KST다.
date-only는 KST 달력 날짜로, timezone 없는 timestamp는 KST로 해석한다.

## E. 25 vs 33

정확한 25/33 과거 화면은 재현하지 못했다. 당시 데이터 snapshot, 브리핑 날짜/시간,
검색어, 선택 출처 및 고객 timezone이 없다. A/B/C 중 실제 해당 사건을 확정할 수 없다.

확인된 요인은 다음과 같다.

1. 일반 조회는 `published_date <= getCollectionCutoffIso(selectedDate, selectedTime)`다.
   최초 발견/수집 시각 필터가 아니므로 과거 수집 snapshot을 재현하지 않는다.
   검색은 기존처럼 전체 기간을 조회한다.
2. 수정 전 recentNotices는 선택 날짜 23:59:59 KST에서 local `setDate(-7)` 및
   local `setHours(0)`를 호출했다. 10/9 선택 시 하한은 Seoul `10/1 15:00Z`,
   UTC `10/2 00:00Z`, Los Angeles `10/2 07:00Z`로 달라진다.
   Seoul에서는 선택일을 포함하여 8개 달력 날짜가 들어가는 문제도 있다.
3. 초기 SSR 조회에는 브리핑 cutoff/DELETED 제외가 없었다. 이후 client fetch와
   대상 집합이 달라 첫 화면과 로딩 후 건수가 달라질 수 있었다.
4. 각 조회 최대 500건, 출처 필터, 현재 lifecycle 상태 및 이후 수집도 건수에 영향을 준다.

현재 DB에서 10/1~10/10 공공기관 기사(전문지/국가법령 제외) 131건을 조회하여
**500건 제한 없는 비교용 표본**에 과거 함수를 적용했다. 10/9 08:30 선택 시
Seoul 77 / UTC 67 / Los Angeles 55건이었다. 이는 timezone 영향의 증거이며
25/33 화면 재현 결과가 아니다. 동일 표본에서 마감 시각 이후 created_at인 기사도
있어 게시일 cutoff만으로 최초 수집 시점 snapshot을 복원할 수 없음을 확인했다.

## F. Proposed Contract

| 후보 | 장점 | 한계 | 10/7 게시, 10/9 최초 저장 |
| --- | --- | --- | --- |
| A: published_date=선택일 | 게시일 기준 단순함 | 기존 '새로 수집' 의미와 다름 | 10/9 NEW 아님 |
| B: first_seen KST=선택일 | 수집일 의미에 맞음 | 현재 컬럼 없음; UPDATE/DELETED와 충돌 가능 | 10/9 신규 강조 가능 |
| C: status=NEW AND first_seen KST=선택일 | lifecycle과 화면 의미 분리 | 최초 저장 시각의 신뢰성 필요; 이후 UPDATE된 기사 역사 복원 불가 | 10/9 NEW |

C를 채택하고 확인된 최초 저장 시각 created_at을 사용한다. 안내 문구는
'선택한 날짜(KST)에 처음 수집·저장된 기사 중 신규 상태인 기사'다.
이전 날짜의 DB NEW는 화면/CSV에서 '유지', UPDATE는 기존대로 표시한다.
UPDATE는 변경일 한정 표시가 아니며, DELETED는 목록 누락에 따른 분류다.

날짜는 KST 고정. 주요 공지 범위는 선택일 포함 7개 KST 달력 날짜
(`selectedDate - 6` 자정부터 선택 briefing slot의 `:59`초까지)다.
검색 및 출처/페이지 기능은 유지하며 주요 공지에는 명시적인 범위 상한을 적용한다.

이 화면은 현재 저장 데이터의 날짜별 조회다. UPDATE/삭제 등의 과거 상태와
당시 수집 결과를 복원하는 역사 snapshot 기능은 이 수정에 포함하지 않는다.

## G. Changes

- `src/lib/articleDisplay.ts`: KST formatter, 날짜 해석, NEW 판정/표시 상태,
  주요 공지 기간 계산. 원본 기사 객체/DB status를 변경하지 않는다.
- `src/components/ArticleList.tsx`: 주요 공지/모달/기관 카드/CSV 날짜 일관화,
  표시 상태 분리, 안내 문구, KST 7일 및 briefing time 적용.
- `src/app/page.tsx`: KST 기준 초기 조회, client와 동일한 cutoff/삭제 제외.
- `tests/articleDisplay.test.mjs`: NEW/과거 날짜/늦은 발견/누락 시각/자정 경계/
  시간 선택/7일 경계/출처/페이지 및 별도 timezone 프로세스 회귀 테스트 8개.

## H. Validation

- 최신 main 기준 frontend 전체 테스트: PASS, 160/160 (새 테스트 8개 포함).
  최초 base에서도 151/151 통과했다.
- TypeScript `npx tsc --noEmit`: PASS.
- ESLint `npm run lint`: PASS.
- `npm run build`: PASS, Next.js 16.3.1.
- 브라우저: 로컬 production build와 읽기 전용 fixture REST server로 PASS.
  Chromium Seoul/UTC/Los Angeles 각 환경에서 날짜, NEW, 과거 브리핑,
  시간 선택, 검색, 출처 필터, 페이지 이동, 모달, CSV를 실제 UI로 검증했다.
  세 환경 모두 page error 0건. 운영 backend와의 브라우저 E2E는 수행하지 않았다.
- 운영 문제 기사 SELECT 및 schema 조사: PASS. 원문 날짜/과거 25/33 재현: 미확인.
- 초기 sandbox의 child process 제한으로 시험 실행이 실패했으나 허용된 실행
  환경으로 재실행해 통과했다. 운영 설정/환경변수 변경은 없다.

## I. PR / 운영 영향 / Rollback

별도 `fix/new-badge-kst-briefing` branch. PR 번호와 최종 SHA는 최종 보고에 기록한다.
Collector, 운영 DB/스키마, workflow, 운영/preview 환경변수 및 Vercel 설정 변경 없음.
Collector 수동 실행, Actions rerun, 기존 PR merge 및 운영 배포도 하지 않았다.
반영 전까지 운영 표시 동작은 그대로다. merge 후 반영 시 NEW/날짜/공지 범위 및
최초 화면 대상 집합이 바뀐다. 8개 날짜였던 범위를 7개 날짜로 바로잡아 건수는 달라질 수 있다.
Rollback은 해당 PR 변경을 revert하는 것으로 가능하며 DB rollback은 필요 없다.

## J. Customer Reply

확인 결과, NEW 상태가 다음 날에도 유지되는 구조와 브라우저 시간대에 따른
날짜 표시 차이가 확인되었습니다. 선택한 브리핑 날짜에 처음 수집·저장된 기사에만
NEW가 표시되도록 수정하고, 날짜와 7일 공지 범위도 한국 시간으로 통일했습니다.
안내 문구와 관련 기능 검증을 마쳤으며, 현재 검토 단계로 운영 반영 전입니다.
25건과 33건의 차이는 당시 화면 조건과 데이터가 없어 정확한 원인을 확정하지 못했습니다.

## K. Verdict / 사용량

코드 검증 기준 MERGE READINESS: PASS. 과거 원문 날짜/25·33건 설명에는 위 한계가 있다.
PR의 최종 mergeability와 remote checks는 최종 보고에 기록한다.

이번 작업의 정확한 컨텍스트/토큰 사용량, 주간 사용량·잔여 %, 5시간 한도 사용량·잔여량,
초기화 시각/날짜·남은 기간, 초기화권 잔여 횟수·날짜: 모두 **조회 불가**.
