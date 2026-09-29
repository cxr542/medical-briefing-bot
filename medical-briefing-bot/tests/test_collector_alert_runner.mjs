import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('../', import.meta.url));
const runnerPath = fileURLToPath(new URL('../scripts/collector-alert-runner.mjs', import.meta.url));
const fetchMockPath = fileURLToPath(new URL('./fixtures/collector-alert-fetch-mock.mjs', import.meta.url));

const runScenario = scenario => spawnSync(
  process.execPath,
  ['--import', fetchMockPath, runnerPath],
  {
    cwd: repositoryRoot,
    encoding: 'utf8',
    env: {
      ALERT_TEST_SCENARIO: scenario,
      SUPABASE_URL: 'https://collector-alert.test.invalid',
      SUPABASE_KEY: 'test-only-key',
    },
  },
);

test('runner exits successfully for a normal evaluation without a state transition', () => {
  const result = runScenario('normal');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ALERT_ENGINE source=Collector status=NORMAL/);
  assert.match(result.stdout, /alert=NOT_TRIGGERED/);
});

test('runner exits successfully for a degraded evaluation without an alert transition', () => {
  const result = runScenario('degraded');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ALERT_ENGINE source=Example source status=WARN/);
  assert.match(result.stdout, /alert=NOT_TRIGGERED/);
});

test('runner succeeds after persisting a stale alert with an empty 201 response', () => {
  const result = runScenario('stale-alert');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ALERT source=Collector status=STALE/);
  assert.match(result.stdout, /ALERT_ENGINE_PERSISTED: transitions=1 active=1/);
  assert.doesNotMatch(result.stderr, /Unexpected end of JSON input/);
});

test('runner succeeds after persisting stale recovery with an empty 201 response', () => {
  const result = runScenario('persist-success');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RECOVERED source=Collector status=RECOVERED/);
  assert.match(result.stdout, /ALERT_ENGINE_PERSISTED: transitions=1 active=0/);
  assert.doesNotMatch(result.stderr, /Unexpected end of JSON input/);
});

test('runner succeeds after a minimal upsert response with HTTP 200 and no body', () => {
  const result = runScenario('persist-success-200');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /ALERT_ENGINE_PERSISTED: transitions=1 active=0/);
});

test('runner fails with a sanitized error when the collector_runs query fails', () => {
  const result = runScenario('query-fails');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Supabase REST request failed with HTTP 503\./);
  assert.doesNotMatch(result.stderr, /unavailable|test-only-key|test\.invalid/);
});

test('runner fails with a sanitized error when alert state persistence fails', () => {
  const result = runScenario('persistence-fails');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Supabase REST request failed with HTTP 503\./);
  assert.doesNotMatch(result.stderr, /unavailable|test-only-key|test\.invalid/);
});
