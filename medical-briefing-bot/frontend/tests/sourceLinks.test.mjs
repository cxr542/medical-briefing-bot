import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveSourceLink } from '../src/lib/sourceLinks.ts';

const portalCases = [
  ...[2279, 2280, 2281].map(id => ['심평원 e-평가 (평가알림방)', `https://aq.hira.or.kr/hira_aq/index.jsp#brdSno=${id}`, 'https://aq.hira.or.kr/hira_aq/index.jsp', '평가알림방']),
  ...[2146, 2145, 2142].map(id => ['산재업무포탈', `https://total.comwel.or.kr/#ser=${id}`, 'https://total.comwel.or.kr/', '공지사항']),
  ['보건의료자원포탈', 'https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok#no=758', 'https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok', '공지사항'],
  ['건보공단 업무포탈', 'https://medicare.nhis.or.kr/portal/index.do?artiId=26POR0000006000000000000005886', 'https://medicare.nhis.or.kr/portal/index.do', '공지사항'],
  ['건보공단 업무포탈 (요양기관)', 'https://medicare.nhis.or.kr/portal/index.do?artiId=26POR0000006000000000000005842', 'https://medicare.nhis.or.kr/portal/index.do', '공지사항'],
  ['심평원 업무포탈 (자보알림방)', 'http://biz.hira.or.kr/indexS.ndo?PROGRAM_ID=MP00000616&PROGRAM_PARAM=nttId==75941', 'https://biz.hira.or.kr/index.do', '자보알림방'],
  ['질병관리청 보도자료', 'https://www.kdca.go.kr/bbs/kdca/42/artclList.do?page=1&srchWrd=title', 'https://www.kdca.go.kr/bbs/kdca/42/artclList.do', '보도자료'],
];

for (const [source, url, destination, board] of portalCases) {
  test(`institution guidance replaces the unsafe detail claim for ${url}`, () => {
    const article = Object.freeze({ source, url, title: '확인할 공지 제목' });
    const result = resolveSourceLink(article);
    assert.equal(result.kind, 'institution');
    assert.equal(result.href, destination);
    assert.equal(result.board, board);
    assert.ok(result.institution.length > 0);
    assert.ok(result.steps.length > 0);
    assert.equal(article.url, url);
  });
}

const directCases = [
  ['식품의약품안전처 보도자료', 'https://www.mfds.go.kr/brd/m_99/view.do?seq=50403'],
  ['보건복지부 보도자료', 'https://www.mohw.go.kr/board.es?mid=a10503000000&bid=0027&list_no=1492185&act=view'],
  ['보건복지부 법령', 'https://www.mohw.go.kr/board.es?bid=0026&act=view&list_no=1492183&tag=&nPage=1'],
  ['대한병원협회 공지사항', 'https://www.kha.or.kr/kha_home/notice_list.do?mode=view&articleNo=47628'],
  ['심평원 업무포탈 (공지사항)', 'http://biz.hira.or.kr/indexS.ndo?PROGRAM_ID=MP00000616&PROGRAM_PARAM=nttId==76023'],
  ['심사평가원 공지사항', 'https://www.hira.or.kr/bbsDummy.do?pgmid=HIRAA020002000100&brdScnBltNo=4&brdBltNo=12299'],
  ['국가법령정보센터', 'https://www.law.go.kr/LSW/lsInfoP.do?lsiSeq=290667'],
  ['국민건강보험공단 공지사항', 'https://www.nhis.or.kr/nhis/together/wbhaea01000m01.do?mode=view&articleNo=11013171'],
  ['질병관리청 보도자료', 'https://www.kdca.go.kr/bbs/kdca/42/312868/artclView.do'],
  ['데일리메디', 'https://www.dailymedi.com/news/news_view.php?ca_id=21&wr_id=941293'],
  ['데일리메디', 'https://dailymedi.com/news/news_view.php?ca_id=21&wr_id=941293'],
  ['메디게이트뉴스', 'https://www.medigatenews.com/news/1938565427'],
  ['보건신문', 'http://www.bokuennews.com/news/article.html?no=285280'],
  ['의학신문', 'https://www.bosa.co.kr/news/articleView.html?idxno=3013612'],
  ['의협신문', 'http://www.doctorsnews.co.kr/news/articleView.html?idxno=166691'],
  ['청년의사', 'http://www.docdocdoc.co.kr/news/articleView.html?idxno=3043479'],
];

for (const [source, url] of directCases) {
  test(`verified detail keeps its exact stored destination for ${source}`, () => {
    const article = Object.freeze({ source, url, title: '공지' });
    assert.deepEqual(resolveSourceLink(article), { kind: 'direct', href: url, label: '원문 바로가기' });
  });
}

for (const url of ['', '/relative', 'javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/a',
  'https://user:password@aq.hira.or.kr/hira_aq/index.jsp#brdSno=2279',
  'https://aq.hira.or.kr.evil.example/hira_aq/index.jsp#brdSno=2279',
  'https://aq.hira.or.kr:8443/hira_aq/index.jsp#brdSno=2279']) {
  test(`unsafe or mismatched destination is noninteractive: ${url}`, () => {
    assert.equal(resolveSourceLink({ source: '심평원 e-평가 (평가알림방)', title: '공지', url }).kind, 'unavailable');
  });
}

test('missing and malformed fragment identifiers never synthesize a detail URL', () => {
  for (const fragment of ['', '#brdSno=', '#brdSno=wrong', '#brdSno=2280&brdSno=2279']) {
    const result = resolveSourceLink({ source: '심평원 e-평가 (평가알림방)', title: '공지', url: `https://aq.hira.or.kr/hira_aq/index.jsp${fragment}` });
    assert.equal(result.kind, 'institution');
    assert.equal(result.href, 'https://aq.hira.or.kr/hira_aq/index.jsp');
  }
});

test('wrong board and missing identifier are not certified as detail links', () => {
  for (const url of ['https://www.mohw.go.kr/board.es?bid=0026&list_no=1492185&act=view',
    'https://www.mohw.go.kr/board.es?bid=0027&list_no=&act=view',
    'https://www.mohw.go.kr/board.es?bid=0027&list_no=1492185&act=list']) {
    assert.equal(resolveSourceLink({ source: '보건복지부 보도자료', title: '공지', url }).kind, 'unverified');
  }
});

test('unrecognized sources preserve safe links without claiming verification', () => {
  const url = 'https://example.org/notice/7#section';
  assert.deepEqual(resolveSourceLink({ source: '추가 기관', title: '공지', url }),
    { kind: 'unverified', href: url, label: '링크 열기 (상세 미확인)' });
});

test('a related link is resolved using its own institution and board', () => {
  const related = { source: '산재업무포탈', title: '연관 공지', url: 'https://total.comwel.or.kr/#ser=2145' };
  assert.equal(resolveSourceLink(related).href, 'https://total.comwel.or.kr/');
});
