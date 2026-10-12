import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveSourceLink } from '../src/lib/sourceLinks.ts';
import { kdcaNotices, storedKdcaArticle } from './fixtures/kdca-verified.mjs';
const fixture = JSON.parse(readFileSync(new URL('../../tests/fixtures/source-detail-links.json', import.meta.url), 'utf8'));
const article = storedKdcaArticle({ title: '오프라인 계약 공지' });

test('validated metadata selects official detail without mutating identity', () => {
  for (const detail of fixture.valid) {
    const input = Object.freeze({ ...article, source_detail_url: detail });
    assert.deepEqual(resolveSourceLink(input), { kind: 'direct', href: detail, label: '원문 바로가기' });
    assert.equal(input.url, article.url);
  }
});
test('shared unsafe metadata fixtures retain institution fallback', () => {
  const expected = resolveSourceLink(article);
  assert.equal(expected.kind, 'institution');
  for (const detail of fixture.invalid) assert.deepEqual(resolveSourceLink({ ...article, source_detail_url: detail }), expected, JSON.stringify(detail));
});
test('missing, NULL and invalid metadata preserve all PR71 verified mappings', () => {
  for (const notice of kdcaNotices) {
    const input = storedKdcaArticle(notice), expected = resolveSourceLink(input);
    assert.equal(expected.href, `https://www.kdca.go.kr/bbs/kdca/42/${notice.id}/artclView.do`);
    assert.equal(expected.kind, 'direct');
    for (const detail of [undefined, ...fixture.invalid]) assert.deepEqual(resolveSourceLink({ ...input, source_detail_url: detail }), expected);
  }
});
test('valid metadata precedes legacy mapping and legacy remains when absent', () => {
  const input = storedKdcaArticle(kdcaNotices[0]);
  assert.equal(resolveSourceLink({ ...input, source_detail_url: fixture.detail }).href, fixture.detail);
  assert.equal(resolveSourceLink(input).href, 'https://www.kdca.go.kr/bbs/kdca/42/312868/artclView.do');
});
test('metadata cannot bypass source, identity, path, title, query or hash guards', () => {
  for (const change of [{ source: 'Unknown' }, { url: 'https://evil.test/a' }, { url: 'javascript:alert(1)' },
    { title: 'different' }, { url: article.url + '#' }, { url: article.url + '#hash' },
    { url: article.url + '&extra=1' }, { url: article.url.replace('/42/', '/43/') }, { url: article.url.replace('https:', 'http:') }]) {
    const input = { ...article, ...change };
    assert.deepEqual(resolveSourceLink({ ...input, source_detail_url: fixture.detail }), resolveSourceLink(input));
  }
});
test('matching official detail identity supports metadata', () => {
  assert.equal(resolveSourceLink({ ...article, url: fixture.detail, source_detail_url: fixture.detail }).href, fixture.detail);
});
test('PR70 NHIS and other sources retain prior resolution for any optional metadata', () => {
  const examples = [
    ['건보공단 업무포탈', 'https://medicare.nhis.or.kr/portal/index.do?artiId=26POR0000006000000000000005886', 'direct'],
    ['심평원 e-평가 (평가알림방)', 'https://aq.hira.or.kr/hira_aq/index.jsp#brdSno=2279', 'institution'],
    ['산재업무포탈', 'https://total.comwel.or.kr/', 'institution'],
    ['보건의료자원포탈', 'https://www.hurb.or.kr/hira_sg/index.jsp?sso=ok', 'institution'],
    ['심평원 업무포탈 (자보알림방)', 'https://biz.hira.or.kr/indexS.ndo', 'institution'],
    ['식품의약품안전처 보도자료', 'https://www.mfds.go.kr/brd/m_99/view.do?seq=50403', 'direct'],
  ];
  for (const [source, url, kind] of examples) {
    const input = { source, url, title: '공지' }, expected = resolveSourceLink(input);
    assert.equal(expected.kind, kind);
    for (const detail of [undefined, fixture.detail, ...fixture.invalid]) assert.deepEqual(resolveSourceLink({ ...input, source_detail_url: detail }), expected);
  }
});
test('page SELECT remains compatible with old schema and omits explicit new column', () => {
  const page = readFileSync(new URL('../src/app/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /\.select\(['"]\*['"]\)/);
  assert.doesNotMatch(page, /\.select\([^)]*source_detail_url/);
});
