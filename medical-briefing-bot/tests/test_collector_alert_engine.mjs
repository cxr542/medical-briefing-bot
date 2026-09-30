import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { evaluateCollectorAlerts } from '../frontend/src/lib/collectorAlertEngine.mjs';
import {
  COLLECTION_DISPLAY_SCHEDULE_KST,
  COLLECTION_RUNTIME_SCHEDULE_KST,
  getCollectionCutoffIso,
  getKstDateKey,
  getLatestCollectionDisplayTime,
  getLatestCollectionRuntimeTime,
  shiftKstDate,
} from '../frontend/src/lib/collectionSchedule.mjs';
import { getCollectorHealth, getNextCollectionDueAt } from '../frontend/src/lib/collectorHealthEngine.mjs';

const dailyCollectorWorkflow = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/daily_collector.yml'),
  'utf8',
);

const NOW = Date.parse('2026-09-28T06:10:00.000Z');
const sourceName = '질병관리청 보도자료';
const currentSourceNames = [
  '보건신문', '의학신문', '의협신문', '청년의사', '데일리메디', '심평원 e-평가',
  '메디게이트뉴스', '보건복지부 법령', '국가법령정보센터', '보건의료자원포탈',
  '보건복지부 보도자료', '심사평가원 공지사항', '질병관리청 보도자료',
  '대한병원협회 공지사항', '심평원 e-평가 (평가알림방)',
  '국민건강보험공단 공지사항', '식품의약품안전처 보도자료',
];

const run = (id, finishedAt, result, status = 'OK', reason = '') => ({
  id,
  finished_at: finishedAt,
  result,
  source_health: {
    [sourceName]: { count: status === 'OK' ? 1 : 0, status, reason },
  },
});

const failedRun = (id, finishedAt) => run(id, finishedAt, 'DEGRADED', 'FAILED', 'KDCA parsing failed');

test('NORMAL health produces no alert', () => {
  const allHealthyRun = {
    id: 1,
    finished_at: '2026-09-28T03:07:00.000Z',
    result: 'SUCCESS',
    source_health: Object.fromEntries(currentSourceNames.map(name => (
      [name, { count: 0, status: 'OK', reason: '정상 0건' }]
    ))),
  };
  const result = evaluateCollectorAlerts(
    [allHealthyRun], {}, NOW,
  );
  assert.equal(result.health.state, 'NORMAL');
  assert.equal(result.health.sources.length, currentSourceNames.length);
  assert.equal(result.events.length, 0);
});

test('runtime, display, and GitHub UTC schedules stay aligned', () => {
  assert.deepEqual(COLLECTION_RUNTIME_SCHEDULE_KST, ['08:30', '12:07', '15:07', '17:07']);
  assert.deepEqual(COLLECTION_DISPLAY_SCHEDULE_KST, ['08:30', '12:00', '15:00', '17:00']);
  assert.deepEqual([...dailyCollectorWorkflow.matchAll(/- cron: '([^']+)'/g)].map(([, cron]) => cron), [
    '7 3,6,8 * * *',
    '30 23 * * *',
  ]);
});

test('KST date remains today before the first scheduled run and across UTC midnight', () => {
  assert.equal(getKstDateKey('2026-09-29T15:05:00.000Z'), '2026-09-30');
  assert.equal(getKstDateKey('2026-09-29T23:20:00.000Z'), '2026-09-30');
  assert.equal(shiftKstDate('2026-09-30', -1), '2026-09-29');
  assert.equal(shiftKstDate('2026-09-30', 1), '2026-10-01');
});

test('latest public slot follows the KST runtime schedule', () => {
  const cases = [
    ['2026-09-29T23:20:00.000Z', '08:30', '08:30'],
    ['2026-09-29T23:40:00.000Z', '08:30', '08:30'],
    ['2026-09-30T03:10:00.000Z', '12:07', '12:00'],
    ['2026-09-30T08:10:00.000Z', '17:07', '17:00'],
  ];

  for (const [instant, runtimeTime, displayTime] of cases) {
    assert.equal(getLatestCollectionRuntimeTime(instant), runtimeTime);
    assert.equal(getLatestCollectionDisplayTime(instant), displayTime);
  }
});

test('article cutoff retains the selected runtime minute in KST', () => {
  assert.equal(
    getCollectionCutoffIso('2026-09-30', '12:07'),
    '2026-09-30T03:07:59.000Z',
  );
});

test('Health Engine uses the next day first run and two-hour stale grace', () => {
  const finishedAt = '2026-09-30T08:07:00.000Z';
  assert.equal(getNextCollectionDueAt(finishedAt), '2026-09-30T23:30:00.000Z');

  const run = {
    id: 1,
    finished_at: '2026-09-30T06:07:00.000Z',
    result: 'SUCCESS',
    source_health: { 정상기관: { count: 1, status: 'OK', reason: '' } },
  };
  const staleAt = Date.parse('2026-09-30T10:07:00.000Z');
  assert.equal(getCollectorHealth([run], staleAt).state, 'NORMAL');
  const staleHealth = getCollectorHealth([run], staleAt + 1);
  assert.equal(staleHealth.state, 'STALE');
  assert.equal(staleHealth.nextCollectionDueAt, '2026-09-30T08:07:00.000Z');
});

test('one KDCA failure is recorded without notification', () => {
  const result = evaluateCollectorAlerts([failedRun(1, '2026-09-28T03:07:00.000Z')], {}, NOW);
  assert.equal(result.health.state, 'DEGRADED');
  assert.equal(result.health.sources[0].consecutiveFailures, 1);
  assert.equal(result.events.length, 0);
});

test('two consecutive core-source failures trigger one alert', () => {
  const runs = [
    failedRun(2, '2026-09-28T03:07:00.000Z'),
    failedRun(1, '2026-09-27T23:30:00.000Z'),
  ];
  const result = evaluateCollectorAlerts(runs, {}, NOW);
  assert.equal(result.health.sources[0].consecutiveFailures, 2);
  assert.deepEqual(result.events.map(event => event.type), ['ALERT']);
  assert.equal(result.events[0].key, `source:${sourceName}`);
});

test('third consecutive failure keeps the incident active without a duplicate', () => {
  const twoFailures = [
    failedRun(2, '2026-09-28T03:07:00.000Z'),
    failedRun(1, '2026-09-27T23:30:00.000Z'),
  ];
  const state = evaluateCollectorAlerts(twoFailures, {}, NOW).state;
  const threeFailures = [
    failedRun(3, '2026-09-28T04:07:00.000Z'),
    ...twoFailures,
  ];
  const result = evaluateCollectorAlerts(threeFailures, state, NOW);
  assert.equal(result.events.length, 0);
  assert.equal(Object.keys(result.state.activeIncidents).length, 1);
});

test('source recovery emits one RECOVERED event and then stays quiet', () => {
  const twoFailures = [
    failedRun(2, '2026-09-28T03:07:00.000Z'),
    failedRun(1, '2026-09-28T00:07:00.000Z'),
  ];
  const activeState = evaluateCollectorAlerts(twoFailures, {}, NOW).state;
  const recoveredRuns = [run(3, '2026-09-28T06:08:00.000Z', 'SUCCESS')];
  const recovered = evaluateCollectorAlerts(recoveredRuns, activeState, NOW);
  assert.deepEqual(recovered.events.map(event => event.type), ['RECOVERED']);
  const stillNormal = evaluateCollectorAlerts(recoveredRuns, recovered.state, NOW);
  assert.equal(stillNormal.events.length, 0);
});

test('Collector FAILED alerts immediately', () => {
  const result = evaluateCollectorAlerts(
    [run(1, '2026-09-28T03:07:00.000Z', 'FAILED')], {}, NOW,
  );
  assert.equal(result.events[0]?.key, 'collector:failed');
  assert.equal(result.events[0]?.type, 'ALERT');
});

test('stale collector emits a deduplicated STALE alert', () => {
  const runs = [run(1, '2026-09-28T03:07:00.000Z', 'SUCCESS')];
  const staleAt = Date.parse('2026-09-28T10:08:00.000Z');
  const first = evaluateCollectorAlerts(runs, {}, staleAt);
  assert.equal(first.health.state, 'STALE');
  assert.equal(first.events[0]?.key, 'collector:stale');
  const duplicate = evaluateCollectorAlerts(runs, first.state, staleAt + 900000);
  assert.equal(duplicate.events.length, 0);
});

test('second degraded run without a core-source incident creates one collector incident', () => {
  const degradedRun = (id, finishedAt) => ({
    id,
    finished_at: finishedAt,
    result: 'DEGRADED',
    source_health: { 보건신문: { count: 0, status: 'FAILED', reason: 'timeout' } },
  });
  const runs = [
    degradedRun(2, '2026-09-28T03:07:00.000Z'),
    degradedRun(1, '2026-09-27T23:30:00.000Z'),
  ];
  const result = evaluateCollectorAlerts(runs, {}, NOW);
  assert.equal(result.health.consecutiveDegradedRuns, 2);
  assert.equal(result.events[0]?.key, 'collector:degraded');
});

test('repeated non-core degradation is deduplicated until recovery', () => {
  const degradedRun = (id, finishedAt) => ({
    id,
    finished_at: finishedAt,
    result: 'DEGRADED',
    source_health: { 보건신문: { count: 0, status: 'FAILED', reason: 'timeout' } },
  });
  const twoRuns = [
    degradedRun(2, '2026-09-28T03:07:00.000Z'),
    degradedRun(1, '2026-09-27T23:30:00.000Z'),
  ];
  const active = evaluateCollectorAlerts(twoRuns, {}, NOW);
  const third = evaluateCollectorAlerts(
    [degradedRun(3, '2026-09-28T06:07:00.000Z'), ...twoRuns], active.state, NOW,
  );
  assert.equal(active.events[0]?.key, 'collector:degraded');
  assert.equal(third.events.length, 0);

  const healthy = evaluateCollectorAlerts(
    [{
      id: 4,
      finished_at: '2026-09-28T06:08:00.000Z',
      result: 'SUCCESS',
      source_health: { 보건신문: { count: 1, status: 'OK', reason: '' } },
    }],
    third.state,
    NOW,
  );
  assert.deepEqual(healthy.events.map(event => event.type), ['RECOVERED']);
});
