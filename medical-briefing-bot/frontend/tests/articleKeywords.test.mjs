import assert from 'node:assert/strict';
import test from 'node:test';
import { extractTitleKeywords, getArticleKeywords } from '../src/lib/articleKeywords.ts';

const REPORTED_TITLE = "[질병군] 행위 별도보상 코드목록('26.10.1.기준)";
const concepts = keywords => keywords.join(' ').replace(/\s/gu, '');

test('reported article preserves its three semantic concepts instead of source-derived terms', () => {
  const article = { source: '심사평가원 공지사항', title: REPORTED_TITLE, keywords: null };
  const result = getArticleKeywords(article);
  for (const concept of ['질병군', '별도보상', '코드목록']) assert.ok(result.includes(concept));
  assert.doesNotMatch(result, /평가|지표|결과/u);
});

test('stored text takes priority without changing its terminology or number of keywords', () => {
  const keywords = '#기존분류, #변경금지, GLP-1, 비만치료제, 온라인 불법판매';
  assert.equal(getArticleKeywords({ title: REPORTED_TITLE, keywords }), keywords);
});

test('a valid stored string array takes priority at the display boundary', () => {
  const keywords = ['GLP-1', '비만치료제', '온라인 불법판매'];
  assert.equal(getArticleKeywords({ title: REPORTED_TITLE, keywords }), keywords.join(', '));
});

for (const keywords of [null, undefined, [], '', '  \n ', 42, {}, [' '], ['GLP-1', null], '[broken', '{}']) {
  test(`missing or malformed stored keywords use grounded fallback: ${JSON.stringify(keywords)}`, () => {
    const result = getArticleKeywords({ title: REPORTED_TITLE, keywords });
    for (const concept of ['질병군', '별도보상', '코드목록']) assert.ok(result.includes(concept));
  });
}

const fixtures = [
  ['의약품안전 주의사항: 비만치료제 안전 공지', ['의약품안전', '비만치료제']],
  ['감염병 예방: 국가예방접종 백신 안내', ['감염병', '백신']],
  ['건강보험 수가기준 개정 안내', ['건강보험', '수가기준']],
  ['급성 신장 손상 위험 예측 AI 모델 개발', ['급성신장손상', 'AI']],
  ['GLP-1 비만치료제 온라인 불법판매 적발', ['GLP-1', '비만치료제', '온라인불법판매']],
  ['필수의약품 공급 안정화 추진', ['필수의약품', '공급']],
];

for (const [title, expected] of fixtures) {
  test(`title-only fallback preserves domain concepts: ${title}`, () => {
    const result = extractTitleKeywords(title);
    for (const concept of expected) assert.ok(concepts(result).includes(concept));
    assert.ok(result.length <= 4);
  });
}

test('a meaningful short title is retained without generic padding', () => {
  assert.deepEqual(extractTitleKeywords('감염병'), ['감염병']);
});

test('empty or generic-only titles yield no invented keywords', () => {
  for (const title of ['', '안내', '공지 결과 정보 관련 확인 기관 업무']) {
    assert.deepEqual(extractTitleKeywords(title), []);
  }
});

test('date parentheses and bracket metadata do not displace bracketed domain terms', () => {
  const result = extractTitleKeywords("[질병군] 별도보상 코드목록 ('26.10.1.기준) (2026-10-06)");
  for (const concept of ['질병군', '별도보상', '코드목록']) assert.ok(concepts(result).includes(concept));
  assert.doesNotMatch(result.join(', '), /2026|26|기준/u);
});

test('generic standalone words are filtered but contextual evaluation phrases survive', () => {
  const result = extractTitleKeywords('폐렴 적정성 평가 자료 제출 안내');
  assert.ok(concepts(result).includes('적정성평가'));
  assert.ok(result.every(word => !['공지', '안내', '결과', '평가'].includes(word)));
});

test('changing only source cannot change fallback keywords, including misleading institution names', () => {
  for (const title of [REPORTED_TITLE, 'GLP-1 비만치료제 안전 공지', '지역 건강보험 수가기준 안내']) {
    const results = ['심사평가원 공지사항', '식품의약품안전평가원', '테스트 기관', '의료질평가 수가 심사 시스템']
      .map(source => getArticleKeywords({ title, source, keywords: null }));
    assert.equal(new Set(results).size, 1);
  }
});

test('category-only stored metadata does not block keyword fallback', () => {
  const result = getArticleKeywords({ title: REPORTED_TITLE, category: '심사/수가', keywords: null });
  assert.ok(result.includes('별도보상'));
});

test('a system match does not infer an unannounced service interruption', () => {
  const result = extractTitleKeywords('재택의료 전산시스템 개편 변경사항 안내');
  assert.doesNotMatch(result.join(', '), /업무중단|점검/u);
  assert.ok(concepts(result).includes('전산시스템'));
});

test('duplicate domain terms do not occupy multiple keyword slots', () => {
  const result = extractTitleKeywords('건강보험 건강보험 수가기준 수가기준 안내');
  assert.equal(result.filter(word => word === '건강보험').length, 1);
  assert.equal(result.filter(word => word === '수가기준').length, 1);
});

test('contextual phrases retain their generic head without duplicating shorter terms', () => {
  const result = extractTitleKeywords('검사 결과 의료AI AI 상시조사표 조사표 안내');
  assert.ok(result.includes('검사 결과'));
  assert.ok(result.includes('의료AI'));
  assert.ok(result.includes('상시조사표'));
  assert.ok(!result.includes('AI') && !result.includes('조사표'));
});

test('title metadata and grammatical filler cannot displace medical nouns', () => {
  const result = extractTitleKeywords('2026년 65세 감염병 백신 임상시험 등을 안내하는 1000여건 소식');
  for (const concept of ['감염병', '백신', '임상시험']) assert.ok(concepts(result).includes(concept));
  assert.doesNotMatch(result.join(', '), /65세|1000|등을|안내하는/u);
});

test('medical nouns ending like particles retain their actual names', () => {
  const result = extractTitleKeywords('심전도 뇌전이 의학전문의 치료강도');
  for (const noun of ['심전도', '뇌전이', '의학전문의', '치료강도']) assert.ok(result.includes(noun));
});

test('a modifier cannot turn a generic-only title into padded keywords', () => {
  for (const title of ['국가 공지 안내', '온라인 정보 확인', '국가 2026년도 공지']) {
    assert.deepEqual(extractTitleKeywords(title), []);
  }
});
