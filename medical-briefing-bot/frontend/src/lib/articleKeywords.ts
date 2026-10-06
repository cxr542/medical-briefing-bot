const GENERIC_WORDS = new Set([
  '공지', '안내', '결과', '정보', '관련', '확인', '기관', '업무', '평가',
  '보도자료', '보도참고', '참고', '알림', '발표', '추진', '실시', '시행',
  '개정', '일부개정', '기준', '기준일', '행위', '신청', '참여', '마감',
  '협조', '요청', '개최', '위한', '관한', '따른', '대상', '통해', '및',
  '등', '더', '의', '자료', '전체판', '포함', '신설', '통과', '체결', '개발',
  '확대', '강화', '증가', '감소', '최신', '소식', '뉴스', '정책동향', '의료계',
  '지침', '일정', '책자', '파일', 'PDF', '한', '중', '전국', '이상', '곳',
  '변경사항', '개편', '부담', '활용', '기반', '마련', '대한', '있다', '없다', '아니다',
]);

const DOMAIN_SIGNAL = /질병군|보상|목록|코드|치료|의약품|감염|보험|수가|백신|접종|의료|진료|질환|평가|안전|급여|청구|점검|사업|시험|연구|신약|항체|출혈|손상|병$|과$|전공의|AI|GLP-\d/iu;
const MODIFIER = /^(급성|만성|잠복|중증|필수|국가|온라인|재가|상대가치)$/u;
const PHRASE_END = /^(안전|평가|기준|예방|지원|공급|손상|질환|치료|불법판매|불법|모델|예측|결과)$/u;
const ORGANIZATION = /(평가원|심사평가원|관리청|안전처|복지부|공단|협회|대학교|의료원)$/u;
const NUMBER_METADATA = /^\d+(?:여)?(년|년도|월|일|차|호|분기|등급|단계|세|위|명|건|개|억|만)?$/u;

export function extractTitleKeywords(title: string): readonly string[] {
  const normalized = title.normalize('NFKC')
    .replace(/&(?:amp;)?(?:quot|apos|#39|#x27);/giu, ' ')
    .replace(/[([{]([^\])}]*\d[^\])}]*)[\])}]/gu, (whole, body: string) =>
      /^[\s\d.'’‘"년월일차호분기:~/-]*(?:기준|시행)?[\s.]*$/u.test(body) ? ' ' : whole)
    .replace(/\d{2,4}[./-]\d{1,2}(?:[./-]\d{1,2})?\.?/gu, ' ');
  const words = normalized.match(/[\p{L}\p{N}]+(?:[-·][\p{L}\p{N}]+)*/gu) ?? [];
  const tokens = words.map(word => {
    const stripped = word.length > 3
      ? word.replace(/(?:으로|에서|에게|까지|부터|은|는|을|를|와)$/u, '') : word;
    return stripped.replace(/([A-Za-z0-9])(?:이|도)$/u, '$1')
      .replace(/(보험|수가|백신|접종|평가|의료|진료|감염병)(?:이|도)$/u, '$1');
  });
  const candidates: { readonly text: string; readonly index: number; readonly score: number }[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const standalone = token.replace(/(?:을|를|에|의|은|는|이|도|가)$/u, '');
    if (GENERIC_WORDS.has(token) || GENERIC_WORDS.has(standalone)
      || NUMBER_METADATA.test(token)
      || token.length < 2 || /(?:한다|된다|했다|됐다|는다|진다|하는|되는)$/u.test(token)) continue;

    let text = token;
    const next = tokens[index + 1];
    if (next && !ORGANIZATION.test(token)
      && ((MODIFIER.test(token) && !GENERIC_WORDS.has(next) && !NUMBER_METADATA.test(next))
        || PHRASE_END.test(next))) {
      text += ` ${next}`;
      index += 1;
      const last = tokens[index + 1];
      if (last && PHRASE_END.test(last)) {
        text += ` ${last}`;
        index += 1;
      }
    }
    if (text === token && MODIFIER.test(token)) continue;
    const score = ORGANIZATION.test(text) ? -1 : DOMAIN_SIGNAL.test(text) ? 2 : 1;
    candidates.push({ text, index, score });
  }

  const selected: typeof candidates = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score || b.text.length - a.text.length || a.index - b.index)) {
    const key = candidate.text.replace(/\s/gu, '').toLocaleLowerCase('en');
    if (selected.some(item => item.text.replace(/\s/gu, '').toLocaleLowerCase('en') === key
      || item.text.toLocaleLowerCase('en').split(' ').includes(candidate.text.toLocaleLowerCase('en'))
      || (/^(?:[가-힣]{3,}|[A-Z]{2,})$/u.test(candidate.text) && item.text.endsWith(candidate.text)))) continue;
    selected.push(candidate);
    if (selected.length === 4) break;
  }
  return selected.sort((a, b) => a.index - b.index).map(item => item.text);
}

const DISPLAY_COMPOUNDS = [{
  id: 'benefit-claim-v1',
  parts: ['요양급여', '청구'],
  label: '요양급여청구',
  binding: /(?:^|[^\p{L}\p{N}])요양급여[ \t]*청구(?=$|[^\p{L}\p{N}])/u,
}] as const;

type DisplayConcept = {
  readonly label: string;
  readonly members: readonly { readonly index: number; readonly raw: string }[];
  readonly ruleId: string | null;
  readonly evidence: string | null;
};

function normalizeCompoundDisplay(title: string, keywords: readonly string[]): string | undefined {
  if (keywords.length <= 3) return undefined;
  const canonical = (value: string) => value.normalize('NFKC').replace(/\s/gu, '');
  for (const rule of DISPLAY_COMPOUNDS) {
    const indices = rule.parts.map(part => keywords.findIndex(keyword => canonical(keyword) === part));
    const evidence = title.normalize('NFKC').match(rule.binding);
    if (indices.some(index => index < 0) || !evidence) continue;
    const consumed = new Set(indices);
    keywords.forEach((keyword, index) => {
      if (canonical(keyword) === rule.label) consumed.add(index);
    });
    const members = [...consumed].sort((a, b) => a - b)
      .map(index => ({ index, raw: keywords[index] }));
    const compound: DisplayConcept = { label: rule.label, members, ruleId: rule.id, evidence: evidence[0].trim() };
    const concepts: readonly DisplayConcept[] = keywords.flatMap((keyword, index) => {
      if (index === members[0].index) return [compound];
      if (consumed.has(index)) return [];
      return [{ label: keyword, members: [{ index, raw: keyword }], ruleId: null, evidence: null }];
    });
    if (concepts.length <= 3) return concepts.map(concept => concept.label).join(', ');
  }
  return undefined;
}

export function getArticleKeywords(article: {
  readonly title: string;
  readonly keywords?: unknown;
}): string {
  const stored = article.keywords;
  if (typeof stored === 'string') {
    const value = stored.trim();
    const annotatedText = /^(?:\[[^\[\]{}"',]+\]|\{[^\[\]{}"',]+\})(?:\s*,|\s*$)/u.test(value);
    if (/\p{L}/u.test(value) && !/^(null|undefined)$/iu.test(value)
      && (!/^[\[{]/u.test(value) || annotatedText)) {
      return normalizeCompoundDisplay(article.title, value.split(',').map(keyword => keyword.trim())) ?? value;
    }
  }
  if (Array.isArray(stored) && stored.length > 0
    && stored.every((keyword: unknown) => typeof keyword === 'string' && /\p{L}/u.test(keyword))) {
    const keywords = stored.map((keyword: string) => keyword.trim());
    return normalizeCompoundDisplay(article.title, keywords) ?? keywords.join(', ');
  }
  const keywords = extractTitleKeywords(article.title);
  return normalizeCompoundDisplay(article.title, keywords) ?? keywords.join(', ');
}
