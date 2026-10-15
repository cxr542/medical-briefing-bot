import assert from 'node:assert/strict';
import test from 'node:test';
import { groupSourceCards, SOURCE_CARD_TYPES } from '../src/lib/sourceCardGroups.ts';

const institutions = ['건보공단 업무포탈', '건보공단 업무포탈 (요양기관)', '국가법령정보센터', '국민건강보험공단 공지사항', '대한병원협회 공지사항', '보건복지부 법령', '보건복지부 보도자료', '보건의료자원포탈', '산재업무포탈', '식품의약품안전처 보도자료', '심사평가원 공지사항', '심평원 e-평가 (평가알림방)', '심평원 업무포탈 (공지사항)', '심평원 업무포탈 (자보알림방)', '질병관리청 보도자료'];
const press = ['데일리메디', '메디게이트뉴스', '메디컬타임즈', '보건신문', '의학신문', '의협신문', '청년의사'];

test('all 22 customer sources appear exactly once in the requested 15/7 groups', () => {
  const groups = groupSourceCards([...press, ...institutions, ...press]);
  assert.deepEqual(groups.map(({ id, title, sources }) => [id, title, sources.length]), [
    ['institution', '주요 기관', 15], ['medical_press', '의료전문지', 7],
  ]);
  assert.deepEqual(groups[0].sources, [...institutions].sort());
  assert.deepEqual(groups[1].sources, [...press].sort());
  assert.equal(new Set(groups.flatMap(group => group.sources)).size, 22);
});

test('zero-article and empty responses keep every configured source visible', () => {
  assert.deepEqual(groupSourceCards([]), groupSourceCards(Object.keys(SOURCE_CARD_TYPES)));
  assert.equal(groupSourceCards(['데일리메디']).flatMap(group => group.sources).length, 22);
});

test('new unclassified sources remain visible once, sorted, in a separate group', () => {
  const groups = groupSourceCards(['신규 기관', '신규 전문지', '신규 기관', 'constructor', '__proto__']);
  assert.deepEqual(groups[2], { id: 'other', title: '기타 출처', sources: ['신규 기관', '신규 전문지', 'constructor', '__proto__'].sort() });
  assert.equal(groups.flatMap(group => group.sources).length, 26);
});

test('grouping preserves source identities for existing counts and selection', () => {
  const original = [...institutions, ...press].sort();
  const counts = Object.fromEntries(original.map((source, index) => [source, index]));
  const snapshot = [...original];
  for (const group of groupSourceCards(original)) {
    assert.deepEqual(group.sources, original.filter(source => group.id === 'institution' ? institutions.includes(source) : press.includes(source)));
    for (const source of group.sources) assert.equal(counts[source], original.indexOf(source));
  }
  assert.deepEqual(original, snapshot);
});
