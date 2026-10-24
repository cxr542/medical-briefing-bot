import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  formatDateKst,
  getDisplayedArticleStatus,
  getRecentNotices,
  isNewForBriefingDate,
} from '../src/lib/articleDisplay.ts';
import { getCollectionCutoffIso } from '../src/lib/collectionSchedule.mjs';
import { filterBySelectedSources } from '../src/lib/medicalPress.ts';

const lateDiscovery = Object.freeze({
  status: 'NEW', published_date: '2026-10-07T00:00:00+09:00',
  created_at: '2026-10-09T00:12:00+09:00',
});

test('NEW follows first stored KST date, including an older publication discovered today', () => {
  assert.equal(isNewForBriefingDate(lateDiscovery, '2026-10-09'), true);
  assert.equal(getDisplayedArticleStatus(lateDiscovery, '2026-10-09'), 'NEW');
  assert.equal(getDisplayedArticleStatus({ ...lateDiscovery, published_date: '2026-10-09' }, '2026-10-09'), 'NEW');
  assert.equal(getDisplayedArticleStatus(lateDiscovery, '2026-10-10'), '유지');
  assert.equal(getDisplayedArticleStatus(lateDiscovery, '2026-10-07'), '유지');
  assert.equal(lateDiscovery.status, 'NEW');
});

test('past briefing selection uses that day, rather than the current clock', () => {
  assert.equal(getDisplayedArticleStatus(lateDiscovery, '2026-10-09'), 'NEW');
  assert.equal(getDisplayedArticleStatus(lateDiscovery, '2026-10-08'), '유지');
});

test('stale NEW, missing/invalid insertion times, and non-NEW states cannot imply a new article', () => {
  for (const created_at of [null, undefined, '', 'invalid', '2026-10-08T14:59:59.999Z']) {
    assert.equal(getDisplayedArticleStatus({ ...lateDiscovery, created_at }, '2026-10-09'), '유지');
  }
  for (const status of ['UPDATE', 'DELETED', '유지']) {
    assert.equal(isNewForBriefingDate({ ...lateDiscovery, status }, '2026-10-09'), false);
    assert.equal(getDisplayedArticleStatus({ ...lateDiscovery, status }, '2026-10-09'), status);
  }
  assert.equal(getDisplayedArticleStatus({ ...lateDiscovery, created_at: '2026-10-08T15:00:00Z' }, '2026-10-09'), 'NEW');
});

test('production POA article is October 8 KST and NEW only on its insertion day', () => {
  const article = { status: 'NEW', published_date: '2026-10-07T15:00:00Z', created_at: '2026-10-08T06:12:52.173377Z' };
  assert.equal(formatDateKst(article.published_date), '2026-10-08');
  assert.equal(getDisplayedArticleStatus(article, '2026-10-08'), 'NEW');
  assert.equal(getDisplayedArticleStatus(article, '2026-10-09'), '유지');
});

test('KST display preserves date-only values and timestamps at midnight boundaries', () => {
  for (const [value, expected] of [
    ['2026-10-07', '2026-10-07'],
    ['2026-10-07T00:00:00+09:00', '2026-10-07'],
    ['2026-10-06T15:00:00Z', '2026-10-07'],
    ['2026-10-07T14:59:59.999Z', '2026-10-07'],
    ['2026-10-07T15:00:00Z', '2026-10-08'],
    ['2026-10-07T00:00:00', '2026-10-07'],
    ['2026-10-07 23:59:59', '2026-10-07'],
  ]) assert.equal(formatDateKst(value), expected);
  assert.equal(formatDateKst('invalid'), '—');
  assert.equal(formatDateKst(null), '—');
  assert.equal(formatDateKst(undefined), '—');
});

test('seven calendar days include the selected day and obey its briefing time during search', () => {
  const articles = [
    { published_date: '2026-10-02T00:00:00+09:00', title: 'old' },
    { published_date: '2026-10-02T23:59:59.999+09:00', title: 'before' },
    { published_date: '2026-10-03', title: 'start' },
    { published_date: '2026-10-09T08:30:59+09:00', title: 'morning' },
    { published_date: '2026-10-09T08:31:00+09:00', title: 'later' },
    { published_date: '2026-10-09T12:07:59+09:00', title: 'noon' },
    { published_date: '2026-10-10', title: 'future' },
    { published_date: 'invalid', title: 'invalid' },
  ];
  assert.deepEqual(getRecentNotices(articles, '2026-10-09', '08:30').map(a => a.title), ['start', 'morning']);
  assert.deepEqual(getRecentNotices(articles, '2026-10-09', '12:07').map(a => a.title), ['start', 'morning', 'later', 'noon']);
  assert.equal(getCollectionCutoffIso('2026-10-09', '12:07'), '2026-10-09T03:07:59.000Z');
});

test('source selection and pagination retain their article identities through display derivation', () => {
  const rows = Array.from({ length: 12 }, (_, id) => ({ ...lateDiscovery, id, source: id < 10 ? '심사평가원 공지사항' : '보건복지부 법령' }));
  const notices = getRecentNotices(filterBySelectedSources(rows, ['심사평가원 공지사항']), '2026-10-09', '17:07');
  assert.deepEqual(notices.slice(0, 5).map(a => a.id), [0, 1, 2, 3, 4]);
  assert.deepEqual(notices.slice(5, 10).map(a => a.id), [5, 6, 7, 8, 9]);
  assert.equal(notices.every(a => getDisplayedArticleStatus(a, '2026-10-09') === 'NEW'), true);
});

test('independent processes in Seoul, UTC and Los Angeles calculate identical display, NEW and windows', () => {
  const helperUrl = new URL('../src/lib/articleDisplay.ts', import.meta.url).href;
  const code = `import { formatDateKst, getDisplayedArticleStatus, getRecentNotices } from ${JSON.stringify(helperUrl)};
    const values = ['2026-10-07', '2026-10-07T00:00:00+09:00', '2026-10-06T15:00:00Z', '2026-10-07T14:59:59.999Z', '2026-10-07T15:00:00Z', '2026-10-07T00:00:00'];
    console.log(JSON.stringify({ dates: values.map(formatDateKst), badge: getDisplayedArticleStatus({status:'NEW',created_at:'2026-10-08T15:00:00Z'}, '2026-10-09'), window: getRecentNotices([{published_date:'2026-10-02T15:00:00Z'}, {published_date:'2026-10-02T14:59:59.999Z'}], '2026-10-09', '08:30') }));`;
  const outputs = ['Asia/Seoul', 'UTC', 'America/Los_Angeles'].map(TZ => {
    const result = spawnSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  });
  assert.deepEqual(outputs[0], outputs[1]);
  assert.deepEqual(outputs[1], outputs[2]);
  assert.equal(outputs[0].badge, 'NEW');
  assert.equal(outputs[0].window.length, 1);
});
