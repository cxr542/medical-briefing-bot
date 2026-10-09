# 기관별 원문 링크 복구 조사 (2026-10-09)

## 기준과 범위

main `73c57bb1786a3e76e4f0f6b67ad491e56ef5192a` 기준. PR #68, #69 포함.
기관 조사 단계는 읽기 전용으로 수행했다. 로그인 우회, Collector 실행, DB 쓰기,
Migration, Production 변경은 수행하지 않았다. 공개 브라우저 이동과 공개 JS 및
HTTP 요청을 비교했다. HTTP 200만으로 성공 판정하지 않고 공지 제목/본문을 확인했다.

## 기관별 결과

| 기관 | 기존 URL | 판정 | 확인 결과 / 필요한 변경 |
|---|---|---|---|
| HIRA e-평가 | `https://aq.hira.or.kr/hira_aq/index.jsp#brdSno=2279` (2280, 2281 동일) | NO_PERMALINK | 세 공지는 내부 목록에서 열리지만 fragment를 상세 이동에 사용하지 않음. 검증된 외부 상세 URL 없음. 안내 유지 |
| COMWEL | `https://total.comwel.or.kr/#ser=2146` (2145, 2142 동일) | NO_PERMALINK / 2146 UNVERIFIED | 2145/2142는 공개 내부 목록에서 본문 확인. fragment는 게시글이 아니라 메뉴 ID로 해석되어 잘못된 메뉴의 로그인 안내 발생. 2146은 현재 공개 목록/검색에서 확인하지 못함 |
| HURB | `https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok#no=758` | NO_PERMALINK | 758 내부 상세 본문 확인. in-memory frame 인자를 사용하며 검증된 외부 상세 링크 없음 |
| NHIS 업무포탈 및 요양기관 | `https://medicare.nhis.or.kr/portal/index.do?artiId=<ID>` | ROUTED | 공식 iframe 상세 경로를 별도 익명 프로필 새 탭에서 6건 확인. 이번 PR에서 표시 href만 계산 |
| HIRA 자보알림방 | `http://biz.hira.or.kr/indexS.ndo?PROGRAM_ID=MP00000616&PROGRAM_PARAM=nttId==75941` | UNVERIFIED | 공개 JS 내부 메뉴 MP00000367과 Collector의 MP00000616 차이 발견. 실제 3건의 외부 상세 이동 미검증. 안내 유지 |
| KDCA | `https://www.kdca.go.kr/bbs/kdca/42/artclList.do?...` | DIRECT | `/bbs/kdca/42/<ID>/artclView.do` 312868, 312844, 312845 새 탭 제목/본문 및 200 확인. 저장 URL 변경에 따른 중복/삭제 상태 위험 때문에 별도 Collector 설계 필요 |

NO_PERMALINK는 이번 조사에서 재현 가능한 공식 URL을 찾지 못했다는 뜻이다.
기관이 모든 직접 연결을 금지한다는 판정은 아니다. 공개 내부 이동 성공은 외부
새 탭 직접 이동 성공과 구분했다. COMWEL 잘못된 hash의 로그인 안내는 실제 공지의
로그인 필요성을 입증하지 않는다.

## 공개 라우팅 근거

### HIRA / HURB

- [HIRA 앱 진입 코드](https://aq.hira.or.kr/hira_aq/HIRA_AQ.xadl.js)는 query를 읽는다.
- [HIRA 홈 이벤트](https://aq.hira.or.kr/hira_aq/frame/frHome.xfdl.js)는
  `divMain_Grid_oncellclick`에서 `brdSno`, `brdKndCd`, `apndGrpDocNo`를
  `openLinkBySubPage`의 frame 인자로 전달한다.
- HIRA 상세는 POST `/com/co/selectBbsInfo.ndo` (200), SSV dsParam의
  `menuId=AQ010601`, `brdKndCd=09`, `brdSno=2279/2280/2281`를 사용했다.
  내부 상세 URL은 index.jsp로 유지된다. 별도 익명 탭의 기존 fragment는 제거되고
  상세 요청이 발생하지 않았다. 파일 다운로드는 임시 토큰 경로로, 안정된 파일 URL 미검증.
- HURB 홈 이벤트는 `p_No=758`, `CP00000114`, `ub_uba::dataVw.xfdl`을 전달한다.
  POST `/ub/uba/selectBrdItemDtl.ndo` (200), `qnaNo=758`, `brdCd=1`.
- 생성 책임: `collector.py`의 HIRA `#brdSno`, HURB `#no` URL 생성.

### COMWEL

- 공개 `/static/_wpack_/ui/total_index.js`의 `_onpageload`는 hash를 메뉴 ID로 처리한다.
- `/static/_wpack_/ui/com/xml/main.js`의 `noticeTtile_onclick`은
  `com.win.openContent("10081005", paramObj)`에 게시글 식별자를 전달한다.
- 목록 POST `/api/v1/total/bizsupport/public/mainPageNotice` (200).
- 상세 POST `/api/v1/total/bizsupport/guide/public/selectFaqView` (200),
  `menuId=10081005`, `ser=2145` 또는 `2142`, `gesipan_ser=4`, `eopmu_fg=00`.
  실제 제목: 청력검사 전문 의료기관 추가인증 결과 알림 / 청력검사 특진의료기관 운영 방법 변경 알림.
- 세 기존 fragment의 새 탭은 루트로 이동하고 잘못된 메뉴의 로그인 안내를 표시했다.
  공지 상세 요청은 발생하지 않았다. 2146은 목록 및 제목 검색 결과에서 확인 불가.
- 생성 책임: `collector_sources/comwel.py`의 `#ser` 생성. 변경하지 않는다.

### NHIS: 이번 PR의 유일한 동작 변경

- [공식 홈 코드](https://medicare.nhis.or.kr/portal/views/bip/mainContent.xml)는
  상세 iframe `/portal/index.do`에 아래 라우팅 매개변수를 전달한다.
- [comLib.js](https://medicare.nhis.or.kr/portal/resources/js/comLib.js)의
  `comLib.encode64`는 WebSquare BASE64Encoder를 사용한다. 관찰된 인코딩은
  UTF-16BE BOM + Base64다. URLSearchParams가 최종 query escaping을 수행한다.
- `w2xPath=/portal/views/bip/az/a/bipaza410m02.xml`, `programId=bipaza410m01`,
  `brdCtsNo=encode(ID)`, `pageNo=encode(1)`, `sidx=encode(0)`,
  빈 검색값 4개 및 `w2xHome=/portal/views/bip/`, `w2xDocumentRoot=`.
- [공식 상세 화면](https://medicare.nhis.or.kr/portal/views/bip/az/a/bipaza410m02.xml)은
  위 ID로 POST `/portal/az/a/410/detail.do`를 호출한다.
  공개 요청 body는 `param.brdCtsNo=ID`, `param.filePgmCode=07`이며 200/제목 일치 확인.
- 다음 6건 모두 별도 익명 프로필에서 새 탭으로 제목 일치를 확인했다.

| Source | ID | 확인 제목 |
|---|---|---|
| 건보공단 업무포탈 | 26POR0000006000000000000005886 | 간호·간병통합서비스 교육전담간호사 지원사업 FAQ 추가안내 |
| 건보공단 업무포탈 | 26POR0000006000000000000005884 | (재택의료) 전산시스템 개편에 따른 변경사항 안내 |
| 건보공단 업무포탈 | 26POR0000006000000000000005882 | 2026년 요양병원 퇴원환자지원 기본교육 사이버 연수원 운영 안내(11차수) |
| 건보공단 업무포탈 (요양기관) | 26POR0000006000000000000005477 | 수진자 자격조회 인증서 로그인 오류 시 보안모듈 재설치 안내 |
| 건보공단 업무포탈 (요양기관) | 25POR0000006000000000000005315 | 한국정보인증(KICA) 네트워크 작업으로 인한 순단 안내 |
| 건보공단 업무포탈 (요양기관) | 25POR0000006000000000000005022 | 첨부파일 업로드/다운로드 기능 관련 빈화면 조치 방법 안내 |

Resolver가 만든 6개 URL과 공식 내부 클릭 URL의 모든 query 값이 일치했다.
허용 조건은 등록 출처/host/path, 게시판 6의 30자리 식별자, 단일 artiId query다.
다른 게시판, 추가 query/hash, 중복 ID, 잘못된 형식은 기존 안내를 유지한다.
형식 검증은 모든 과거 ID의 현재 존재를 보장하지 않는다. 기관 라우팅 변경/게시글 삭제는 잔여 위험이다.

### KDCA와 기존 데이터

- [공식 목록 JS](https://www.kdca.go.kr/Web-home/fnct/bbs/JW_bbs_table/js/artclList.js)의
  `jf_viewArtcl`이 `/bbs/kdca/42/<ID>/artclView.do`로 이동한다.
- 실제 href는 `javascript:jf_viewArtcl('kdca','42','312868')` 형태다.
  `collector_parsers.py`의 현재 추출기는 이 href의 ID를 추출하지 못한다.
  해당 형태의 isolated parser fixture에서도 제목 검색 목록 URL이 생성됨을 확인했다.
  Collector 자체를 실행하지는 않았다.
- `collector.py`는 URL로 기존 상태를 매핑하고 `on_conflict=url`로 upsert한다.
  parser content_hash도 title+URL에 의존한다. 단순 상세 URL 변경은 중복 생성 및
  기존 행의 삭제 상태 판정을 유발할 수 있어 ID 전환 설계/회귀 테스트를 별도 PR로 분리해야 한다.
- 기존 KDCA 검색 URL에는 원문 ID가 없어 제목만으로 안전한 자동 역매핑을 확정할 수 없다.
  검증된 ID 매핑과 별도 승인된 Backfill 여부 검토가 필요하다.
- NHIS는 저장된 artiId로 화면 href만 계산하므로 기존 정상 ID 행에도 코드 배포만으로 적용된다.
  article.url, related_links, content_hash 및 중복 판정은 변경하지 않는다. DB 조회/영향 건수는 미확인.

## 검증과 한계

- 프론트엔드 전체 테스트 136/136, ESLint, TypeScript, Next production build 통과.
- 기존 HIRA 2279/2280/2281, COMWEL 2146/2145/2142, HURB 758 안내 및
  식약처/복지부/병원협회 정상 href 회귀 테스트 유지.
- 로컬 GET-only fixture UI에서 NHIS 표/카드 새 탭 href, HIRA 안내 모달/ESC 확인.
- 공식 NHIS Android Chromium 에뮬레이션에서 제목/상세 요청 확인.
  390px touch-enabled viewport에서도 본문 확인하였으나 기관 페이지는 가로 overflow가 있다.
  실제 물리 기기/Safari 검증은 하지 못했다. iPhone UA 시도는 안정된 본문 확인에 실패하여 PASS로 간주하지 않는다.
- 비밀값/쿠키/인증 헤더/raw HAR는 이 문서에 포함하지 않았다.

## 적용 순서 / 롤백

이번 PR은 NHIS resolver + 테스트 + 조사 문서만 포함한다. PR #54/#55 변경 파일과 겹치지 않는다.
HIRA/COMWEL/HURB 및 자보알림방은 추가 공식 공유 경로 확인 전 안내 유지.
KDCA는 별도 Collector/URL identity PR, 필요 시 승인된 Backfill PR 순서로 제안한다.
이번 PR을 revert하면 기존 안내로 복귀하며 데이터 롤백은 필요 없다. 자동 merge하지 않는다.
