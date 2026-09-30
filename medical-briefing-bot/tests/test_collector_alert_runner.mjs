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
      GITHUB_TOKEN: 'test-only-github-token',
      GITHUB_REPOSITORY: 'cxr542/medical-briefing-bot',
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

test('stale slot dispatches the collector once and records the trigger', () => {
  const result = runScenario('dispatch-stale');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TEST_DISPATCH_RECEIVED/);
  assert.match(result.stdout, /TEST_DISPATCH_REF=main/);
  assert.match(result.stdout, /TEST_RECOVERY_INPUT=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+09:00/);
  assert.match(result.stdout, /TEST_RECOVERY_RUN_ID=12345/);
  assert.match(result.stdout, /COLLECTOR_RECOVERY slot=.* status=RECOVERY_TRIGGERED http=200/);
});

test('queued collector run prevents recovery dispatch', () => {
  const result = runScenario('collector-queued');

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /TEST_DISPATCH_RECEIVED|COLLECTOR_RECOVERY/);
});

test('in-progress collector run prevents recovery dispatch', () => {
  const result = runScenario('collector-in-progress');

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /TEST_DISPATCH_RECEIVED|COLLECTOR_RECOVERY/);
});

test('existing attempt for the missed slot is never dispatched again', () => {
  const result = runScenario('dispatch-attempted');

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /TEST_DISPATCH_RECEIVED|COLLECTOR_RECOVERY/);
});

test('latest failed collector run prevents recovery dispatch', () => {
  const result = runScenario('collector-failed');

  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /TEST_DISPATCH_RECEIVED|COLLECTOR_RECOVERY/);
});

test('collector success after a recovery attempt records RECOVERED', () => {
  const result = runScenario('recovery-success');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TEST_RECOVERY_STATUS=RECOVERED/);
  assert.doesNotMatch(result.stdout, /TEST_DISPATCH_RECEIVED/);
});

test('collector failure after a recovery attempt records FAILED without retry', () => {
  const result = runScenario('recovery-failed');

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /TEST_RECOVERY_STATUS=FAILED/);
  assert.doesNotMatch(result.stdout, /TEST_DISPATCH_RECEIVED/);
});

test('dispatch API rejection is recorded as FAILED and is never retried', () => {
  const rejected = runScenario('dispatch-fails');
  const repeated = runScenario('dispatch-attempted-failed');

  assert.equal(rejected.status, 0, rejected.stderr);
  assert.match(rejected.stdout, /COLLECTOR_RECOVERY slot=.* status=FAILED http=403/);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.doesNotMatch(repeated.stdout, /TEST_DISPATCH_RECEIVED/);
});

test('ambiguous dispatch persists its intent and is never retried', () => {
  const ambiguous = runScenario('dispatch-ambiguous');
  const repeated = runScenario('dispatch-attempted-ambiguous');

  assert.equal(ambiguous.status, 0, ambiguous.stderr);
  assert.match(ambiguous.stdout, /status=DISPATCHING outcome=AMBIGUOUS no_retry=true/);
  assert.equal(repeated.status, 0, repeated.stderr);
  assert.doesNotMatch(repeated.stdout, /TEST_DISPATCH_RECEIVED/);
});

test('failed pre-dispatch state persistence prevents dispatch', () => {
  const result = runScenario('dispatch-persist-fails');

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Supabase REST request failed with HTTP 503\./);
  assert.doesNotMatch(result.stdout, /TEST_DISPATCH_RECEIVED/);
});
