import assert from 'node:assert/strict';
import test from 'node:test';

import {
  filterBySelectedSources,
  filterMedicalPressArticles,
  formatMedicalPressDateKst,
  getLastSevenCalendarDaysStartIso,
  MEDICAL_PRESS_PAGE_SIZE,
  MEDICAL_PRESS_SOURCES,
} from '../src/lib/medicalPress.ts';
import {
  COLLECTION_DISPLAY_SCHEDULE_KST,
  COLLECTION_RUNTIME_SCHEDULE_KST,
  getLatestCollectionTime,
  getNextCollectionTime,
} from '../src/lib/collectionStatus.ts';

const NOW = new Date('2026-09-30T05:00:00.000Z'); // 2026-09-30 14:00 KST

function article({ source = '청년의사', title = '의료계 최신 소식', url, publishedDate, category = '', keywords = '' }) {
  return {
    source,
    title,
    url,
    published_date: publishedDate,
    status: 'NEW',
    category,
    keywords,
  };
}

test('medical press group contains the six configured sources', () => {
  assert.deepEqual(MEDICAL_PRESS_SOURCES, ['청년의사', '의협신문', '메디게이트뉴스', '데일리메디', '의학신문', '보건신문']);
});

test('the established runtime schedule and user display schedule remain separate', () => {
  assert.deepEqual(COLLECTION_RUNTIME_SCHEDULE_KST, ['08:30', '12:07', '15:07', '17:07']);
  assert.deepEqual(COLLECTION_DISPLAY_SCHEDULE_KST, ['08:30', '12:00', '15:00', '17:00']);
  const noonKst = new Date('2026-09-30T03:00:00.000Z');
  assert.equal(getLatestCollectionTime(noonKst), '08:30');
  assert.equal(getNextCollectionTime(noonKst), '12:07');
});

test('seven-calendar-day window begins at midnight KST with today included', () => {
  assert.equal(getLastSevenCalendarDaysStartIso(NOW), '2026-09-23T15:00:00.000Z');
});

test('the exact KST boundary is included and one millisecond before is excluded', () => {
  const start = getLastSevenCalendarDaysStartIso(NOW);
  const results = filterMedicalPressArticles([
    article({ url: 'https://press.test/boundary', publishedDate: start }),
    article({ url: 'https://press.test/old', publishedDate: new Date(Date.parse(start) - 1).toISOString() }),
  ], 'last-seven-days', '', NOW);
  assert.deepEqual(results.map(item => item.url), ['https://press.test/boundary']);
});

test('eight-day-old article is excluded from the seven-calendar-day view', () => {
  const old = new Date('2026-09-22T14:59:59.999Z').toISOString();
  assert.equal(filterMedicalPressArticles([article({ url: 'https://press.test/old', publishedDate: old })], 'last-seven-days', '', NOW).length, 0);
});

test('all latest press articles are available even without a search term', () => {
  const rows = [
    article({ url: 'https://press.test/a', publishedDate: '2026-09-29T00:00:00.000Z' }),
    article({ url: 'https://press.test/b', publishedDate: '2026-09-28T00:00:00.000Z' }),
  ];
  assert.equal(filterMedicalPressArticles(rows, 'latest', '', NOW).length, 2);
});

test('duplicate article URLs collapse to one newest item', () => {
  const results = filterMedicalPressArticles([
    article({ url: 'https://press.test/same', title: 'older', publishedDate: '2026-09-28T00:00:00.000Z' }),
    article({ source: '의협신문', url: 'https://press.test/same', title: 'newer', publishedDate: '2026-09-29T00:00:00.000Z' }),
  ], 'latest', '', NOW);
  assert.equal(results.length, 1);
  assert.equal(results[0].title, 'newer');
});

test('medical press articles are ordered by published date descending', () => {
  const results = filterMedicalPressArticles([
    article({ url: 'https://press.test/old', publishedDate: '2026-09-25T00:00:00.000Z' }),
    article({ url: 'https://press.test/new', publishedDate: '2026-09-29T00:00:00.000Z' }),
  ], 'latest', '', NOW);
  assert.deepEqual(results.map(item => item.url), ['https://press.test/new', 'https://press.test/old']);
});

test('existing individual-source selection continues to select only that source', () => {
  const rows = [
    article({ source: '청년의사', url: 'https://press.test/docdoc', publishedDate: '2026-09-29T00:00:00.000Z' }),
    article({ source: '의협신문', url: 'https://press.test/kma', publishedDate: '2026-09-29T00:00:00.000Z' }),
  ];
  assert.deepEqual(filterBySelectedSources(rows, ['의협신문']).map(item => item.source), ['의협신문']);
});

test('medical press group excludes non-member and deleted rows', () => {
  const rows = [
    article({ source: '메디컬타임즈', url: 'https://press.test/legacy', publishedDate: '2026-09-29T00:00:00.000Z' }),
    { ...article({ url: 'https://press.test/deleted', publishedDate: '2026-09-29T00:00:00.000Z' }), status: 'DELETED' },
  ];
  assert.equal(filterMedicalPressArticles(rows, 'latest', '', NOW).length, 0);
});

test('search is applied inside the selected seven-day range', () => {
  const rows = [
    article({ url: 'https://press.test/match', title: '수가 개편 보도', publishedDate: '2026-09-28T00:00:00.000Z' }),
    article({ url: 'https://press.test/no-match', title: '일반 의료계 뉴스', publishedDate: '2026-09-28T00:00:00.000Z' }),
    article({ url: 'https://press.test/old-match', title: '수가 과거 보도', publishedDate: '2026-09-22T14:00:00.000Z' }),
  ];
  assert.deepEqual(filterMedicalPressArticles(rows, 'last-seven-days', '수가', NOW).map(item => item.url), ['https://press.test/match']);
});

test('KST display date is independent of the machine timezone', () => {
  assert.match(formatMedicalPressDateKst('2026-09-23T15:30:00.000Z'), /2026.*09.*24/);
});

test('press pagination keeps each render page bounded', () => {
  assert.equal(MEDICAL_PRESS_PAGE_SIZE, 10);
});
