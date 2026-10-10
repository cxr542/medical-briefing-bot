export type SourceArticle = {
  readonly source: string;
  readonly title: string;
  readonly url: string;
};

type LinkTarget = { readonly href: string; readonly label: string };
export type SourceLinkResolution =
  | (LinkTarget & { readonly kind: 'direct' | 'unverified' })
  | (LinkTarget & {
      readonly kind: 'institution';
      readonly institution: string;
      readonly board: string;
      readonly steps: string;
    })
  | { readonly kind: 'unavailable'; readonly label: string };

const PORTALS = [
  { source: '심평원 e-평가 (평가알림방)', host: 'aq.hira.or.kr', path: '/hira_aq/index.jsp',
    href: 'https://aq.hira.or.kr/hira_aq/index.jsp', institution: '건강보험심사평가원 e-평가',
    board: '평가알림방', steps: '시스템 공지 팝업을 닫고 평가알림방에서 아래 제목을 선택하세요.' },
  { source: '산재업무포탈', host: 'total.comwel.or.kr', path: '/',
    href: 'https://total.comwel.or.kr/', institution: '근로복지공단 고용·산재보험 토탈서비스',
    board: '공지사항', steps: '홈페이지의 공지사항에서 아래 제목을 찾으세요. 목록에 없으면 더보기를 이용하세요. 일부 공지는 현재 목록에 없을 수 있습니다.' },
  { source: '보건의료자원포탈', host: 'www.hurb.or.kr', path: '/hira_sg/index.jsp',
    href: 'https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok', institution: '보건의료자원통합신고포털',
    board: '공지사항', steps: '홈페이지의 공지사항에서 아래 제목을 선택하세요. 목록에 없으면 공지사항 더보기를 이용하세요.' },
  { source: '건보공단 업무포탈', host: 'medicare.nhis.or.kr', path: '/portal/index.do',
    href: 'https://medicare.nhis.or.kr/portal/index.do', institution: '국민건강보험공단 요양기관정보마당',
    board: '공지사항', steps: '메인 화면의 공지사항에서 아래 제목을 찾으세요. 일부 공지는 로그인이 필요할 수 있습니다.' },
  { source: '건보공단 업무포탈 (요양기관)', host: 'medicare.nhis.or.kr', path: '/portal/index.do',
    href: 'https://medicare.nhis.or.kr/portal/index.do', institution: '국민건강보험공단 요양기관정보마당',
    board: '공지사항', steps: '메인 화면의 공지사항에서 아래 제목을 찾으세요. 일부 공지는 로그인이 필요할 수 있습니다.' },
  { source: '심평원 업무포탈 (자보알림방)', host: 'biz.hira.or.kr', path: '/indexS.ndo',
    href: 'https://biz.hira.or.kr/index.do', institution: '건강보험심사평가원 업무포탈',
    board: '자보알림방', steps: '업무포탈에서 자보알림방을 선택한 뒤 아래 제목을 찾으세요. 상세 접근 조건은 기관에서 확인해 주세요.' },
  { source: '질병관리청 보도자료', host: 'www.kdca.go.kr', path: '/bbs/kdca/42/artclList.do',
    href: 'https://www.kdca.go.kr/bbs/kdca/42/artclList.do', institution: '질병관리청',
    board: '보도자료', steps: '보도자료 목록의 제목 검색으로 아래 공지를 찾은 뒤 제목을 선택하세요.' },
] as const;

const DIRECT_RULES = [
  { source: '식품의약품안전처 보도자료', host: 'www.mfds.go.kr', path: /^\/brd\/m_99\/view\.do$/, id: 'seq' },
  { source: '보건복지부 보도자료', host: 'www.mohw.go.kr', path: /^\/board\.es$/, id: 'list_no', board: '0027' },
  { source: '보건복지부 법령', host: 'www.mohw.go.kr', path: /^\/board\.es$/, id: 'list_no', board: '0026' },
  { source: '대한병원협회 공지사항', host: 'www.kha.or.kr', path: /^\/kha_home\/notice_list\.do$/, id: 'articleNo' },
  { source: '국가법령정보센터', host: 'www.law.go.kr', path: /^\/LSW\/lsInfoP\.do$/, id: 'lsiSeq' },
  { source: '국민건강보험공단 공지사항', host: 'www.nhis.or.kr', path: /^\/nhis\/together\/wbhaea01000m01\.do$/, id: 'articleNo' },
  { source: '심사평가원 공지사항', host: 'www.hira.or.kr', path: /^\/bbsDummy\.do$/, id: 'brdBltNo' },
  { source: '심평원 업무포탈 (공지사항)', host: 'biz.hira.or.kr', path: /^\/indexS\.ndo$/, id: 'PROGRAM_PARAM' },
  { source: '질병관리청 보도자료', host: 'www.kdca.go.kr', path: /^\/bbs\/kdca\/42\/\d+\/artclView\.do$/, id: '' },
  { source: '데일리메디', host: 'www.dailymedi.com', path: /^\/news\/news_view\.php$/, id: 'wr_id' },
  { source: '메디게이트뉴스', host: 'www.medigatenews.com', path: /^\/news\/\d+$/, id: '' },
  { source: '보건신문', host: 'www.bokuennews.com', path: /^\/news\/article\.html$/, id: 'no' },
  { source: '의학신문', host: 'www.bosa.co.kr', path: /^\/news\/articleView\.html$/, id: 'idxno' },
  { source: '의협신문', host: 'www.doctorsnews.co.kr', path: /^\/news\/articleView\.html$/, id: 'idxno' },
  { source: '청년의사', host: 'www.docdocdoc.co.kr', path: /^\/news\/articleView\.html$/, id: 'idxno' },
] as const;

const VERIFIED_KDCA_NOTICES = [
  { title: '[10.8.목.조간] 임신당뇨병 산모의 자녀, 당뇨병 위험 최대 4배 이상 높아',
    href: 'https://www.kdca.go.kr/bbs/kdca/42/312868/artclView.do' },
  { title: '「아이치-나고야 하계 아시아경기대회」 감염병 예방은 마지막까지 빈틈없이!(10.6.화)',
    href: 'https://www.kdca.go.kr/bbs/kdca/42/312844/artclView.do' },
  { title: '질병관리청, 건전한 조직문화 조성을 위한 ‘청렴라이브(LIVE)’ 개최(10.2.금)',
    href: 'https://www.kdca.go.kr/bbs/kdca/42/312845/artclView.do' },
] as const;

function verifiedKdcaHref(url: URL, title: string): string | undefined {
  if (url.origin !== 'https://www.kdca.go.kr'
    || url.pathname !== '/bbs/kdca/42/artclList.do' || url.hash
    || url.searchParams.size !== 3 || url.searchParams.get('page') !== '1'
    || url.searchParams.get('srchColumn') !== 'title'
    || url.searchParams.get('srchWrd') !== title) return undefined;

  return VERIFIED_KDCA_NOTICES.find(notice => notice.title === title)?.href;
}

function nhisNoticeHref(url: URL): string | undefined {
  const identifiers = url.searchParams.getAll('artiId');
  const id = identifiers[0] ?? '';
  if (url.hash || url.searchParams.size !== 1 || identifiers.length !== 1
    || !/^\d{2}POR0000006\d{18}$/.test(id)) return undefined;

  // NHIS mainContent.xml uses comLib.encode64 / WebSquare BASE64Encoder:
  // UTF-16BE with a BOM, then Base64. These inputs are fixed ASCII or validated IDs.
  const encode = (value: string): string => btoa('\xfe\xff' + value.replace(/./g, char => '\x00' + char));
  const target = new URL('https://medicare.nhis.or.kr/portal/index.do');
  target.searchParams.set('w2xPath', '/portal/views/bip/az/a/bipaza410m02.xml');
  target.searchParams.set('programId', 'bipaza410m01');
  target.searchParams.set('pageNo', encode('1'));
  target.searchParams.set('brdCtsNo', encode(id));
  for (const key of ['searchPeriod', 'searchTarget', 'searchText', 'artiPttnCd']) {
    target.searchParams.set(key, encode(''));
  }
  target.searchParams.set('sidx', encode('0'));
  target.searchParams.set('w2xHome', '/portal/views/bip/');
  target.searchParams.set('w2xDocumentRoot', '');
  return target.href;
}

export function resolveSourceLink(article: SourceArticle): SourceLinkResolution {
  const unavailable: SourceLinkResolution = { kind: 'unavailable', label: '원문 링크 확인 필요' };
  let url: URL;
  try {
    url = new URL(article.url);
  } catch (error) {
    if (error instanceof TypeError) return unavailable;
    throw error;
  }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) return unavailable;

  const portal = PORTALS.find(rule => rule.source === article.source);
  const direct = DIRECT_RULES.find(rule => rule.source === article.source);
  const expectedHost = portal?.host ?? direct?.host;
  const dailyMediAlias = article.source === '데일리메디' && url.hostname === 'dailymedi.com';
  if (expectedHost && url.hostname !== expectedHost && !dailyMediAlias) return unavailable;
  if (portal && url.pathname === portal.path) {
    if (portal.host === 'www.kdca.go.kr') {
      const href = verifiedKdcaHref(url, article.title);
      if (href) return { kind: 'direct', href, label: '원문 바로가기' };
    }
    if (portal.host === 'medicare.nhis.or.kr') {
      const href = nhisNoticeHref(url);
      if (href) return { kind: 'direct', href, label: '원문 바로가기' };
    }
    return { kind: 'institution', href: portal.href, label: '기관에서 공지 찾기',
      institution: portal.institution, board: portal.board, steps: portal.steps };
  }

  let verified = false;
  if (direct && direct.path.test(url.pathname)) {
    const id = direct.id ? url.searchParams.get(direct.id) ?? '' : '';
    verified = !direct.id || /^\d+$/.test(id);
    if (direct.id === 'PROGRAM_PARAM') {
      verified = /^nttId==\d+$/.test(id) && url.searchParams.get('PROGRAM_ID') === 'MP00000616';
    }
    if ('board' in direct) verified = verified && url.searchParams.get('bid') === direct.board && url.searchParams.get('act') === 'view';
    if (['대한병원협회 공지사항', '국민건강보험공단 공지사항'].includes(article.source)) {
      verified = verified && url.searchParams.get('mode') === 'view';
    }
    if (article.source === '심사평가원 공지사항') {
      verified = verified && url.searchParams.get('pgmid') === 'HIRAA020002000100' && url.searchParams.get('brdScnBltNo') === '4';
    }
  }
  return { kind: verified ? 'direct' : 'unverified', href: article.url,
    label: verified ? '원문 바로가기' : '링크 열기 (상세 미확인)' };
}
