import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FRONTEND = resolve(ROOT, 'frontend');
const SUPABASE_PORT = 45431;
const TEST_PASSWORD = `test-only-admin-password-${'a'.repeat(40)}`;
const TEST_SERVICE_ROLE_KEY = 'test-only-service-role-key-not-real';
const SOURCE_REASON = 'HTTP 503 test-only upstream reason';
const FINISHED_AT = new Date(Date.now() - 10 * 60 * 1000).toISOString();
const STARTED_AT = new Date(Date.parse(FINISHED_AT) - 60 * 1000).toISOString();
const RUNS = [{
  id: 9,
  started_at: STARTED_AT,
  finished_at: FINISHED_AT,
  result: 'DEGRADED',
  collected_count: 12,
  ai_output_count: 12,
  db_attempted: 8,
  db_succeeded: 8,
  db_failed: 0,
  source_health: {
    정상기관: { count: 12, status: 'OK', reason: '' },
    장애기관: { count: 0, status: 'FAILED', reason: SOURCE_REASON },
  },
}];

let databaseServer;
let appServer;
let appOrigin;
let databaseRequests = 0;
let sawServiceRoleKey = false;
let sawCollectorRunsServiceRole = false;
let sawCollectorRunsAnon = false;
let collectorRunsResponse = RUNS;
let collectorRunsHttpStatus = 200;

const getAvailablePort = async () => {
  const server = createNetServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  await new Promise((resolveClose, rejectClose) => server.close(error => error ? rejectClose(error) : resolveClose()));
  if (!address || typeof address === 'string') throw new Error('Failed to reserve local test port');
  return address.port;
};

const waitForApp = async (child, url) => {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Next server exited before becoming ready');
    try {
      const response = await fetch(`${url}/api/admin/monitoring`, { signal: AbortSignal.timeout(1000) });
      if (response.status === 401) return;
    } catch {
      await delay(150);
    }
  }
  throw new Error('Timed out waiting for local Next server');
};

before(async () => {
  databaseServer = createServer((request, response) => {
    databaseRequests += 1;
    if (request.headers.apikey === TEST_SERVICE_ROLE_KEY) sawServiceRoleKey = true;
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Content-Type', 'application/json');

    if (request.url?.startsWith('/rest/v1/articles')) {
      response.setHeader('Content-Range', '0-1/2');
      response.end(JSON.stringify([{ source: '보건신문' }, { source: '의학신문' }]));
      return;
    }
    if (request.url?.startsWith('/rest/v1/collector_runs')) {
      if (request.headers.apikey === TEST_SERVICE_ROLE_KEY) {
        sawCollectorRunsServiceRole = true;
      } else {
        sawCollectorRunsAnon = true;
        response.statusCode = 401;
        response.end(JSON.stringify({ code: '42501', message: 'permission denied for test role' }));
        return;
      }
      response.statusCode = collectorRunsHttpStatus;
      response.end(collectorRunsHttpStatus === 200
        ? JSON.stringify(collectorRunsResponse)
        : JSON.stringify({ code: 'test_database_error', message: 'internal test failure detail' }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: 'not found' }));
  });
  databaseServer.listen(SUPABASE_PORT, '127.0.0.1');
  await once(databaseServer, 'listening');

  const port = await getAvailablePort();
  appOrigin = `http://127.0.0.1:${port}`;
  appServer = spawn('npm', ['run', 'dev', '--', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: FRONTEND,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      ADMIN_PASSWORD: TEST_PASSWORD,
      SUPABASE_SERVICE_ROLE_KEY: TEST_SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${SUPABASE_PORT}`,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-only-public-anon-key',
    },
    stdio: 'ignore',
  });

  await waitForApp(appServer, appOrigin);
});

after(async () => {
  if (appServer && appServer.exitCode === null) {
    appServer.kill('SIGTERM');
    await Promise.race([once(appServer, 'exit'), delay(3000)]);
    if (appServer.exitCode === null) appServer.kill('SIGKILL');
  }
  if (databaseServer?.listening) {
    await new Promise((resolveClose, rejectClose) => databaseServer.close(error => error ? rejectClose(error) : resolveClose()));
  }
});

test('monitoring API rejects unauthenticated requests before querying Supabase', async () => {
  const requestsBefore = databaseRequests;
  const response = await fetch(`${appOrigin}/api/admin/monitoring`);
  assert.equal(response.status, 401);
  assert.equal(databaseRequests, requestsBefore);
});

test('wrong credential fails generically and correct credential issues a protected session', async () => {
  const login = password => fetch(`${appOrigin}/api/admin/login`, {
    method: 'POST',
    headers: {
      Origin: appOrigin,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });

  const wrong = await login('wrong-test-only-password');
  const wrongBody = await wrong.json();
  assert.equal(wrong.status, 401);

  const correct = await login(TEST_PASSWORD);
  const cookie = correct.headers.get('set-cookie');
  assert.equal(correct.status, 200);
  assert.match(cookie || '', /HttpOnly/);
  assert.doesNotMatch(cookie || '', /Secure/);
  assert.match(cookie || '', /SameSite=Lax/);
  assert.match(cookie || '', /Max-Age=28800/);
  assert.deepEqual(wrongBody, { error: '인증 정보가 올바르지 않습니다.' });
  assert.ok(cookie?.startsWith('medical_briefing_admin_session='));

  const token = cookie.split(';', 1)[0];
  const tokenParts = token.split('.');
  const signature = tokenParts.at(-1) || '';
  tokenParts[tokenParts.length - 1] = `${signature.startsWith('A') ? 'B' : 'A'}${signature.slice(1)}`;
  const tampered = tokenParts.join('.');
  const denied = await fetch(`${appOrigin}/api/admin/monitoring`, {
    headers: { Cookie: tampered },
  });
  assert.equal(denied.status, 401);

  const monitoring = await fetch(`${appOrigin}/api/admin/monitoring`, {
    headers: { Cookie: token },
  });
  assert.equal(monitoring.status, 200);
  const payload = await monitoring.json();
  assert.equal(payload.totalCount, 2);
  assert.deepEqual(payload.stats, [{ source: '보건신문', count: 1 }, { source: '의학신문', count: 1 }]);
  assert.equal(payload.collectorRuns[0].ai_output_count, 12);
  assert.equal(payload.collectorRuns[0].source_health.장애기관.reason, SOURCE_REASON);
  assert.equal(sawServiceRoleKey, true);
});

test('public collection status returns friendly status only, never operational failure reasons', async () => {
  const response = await fetch(`${appOrigin}/api/collection-status`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const payload = await response.json();
  assert.equal(payload.state, 'DEGRADED');
  assert.equal(payload.affectedSources[0].name, '장애기관');
  assert.equal(JSON.stringify(payload).includes(SOURCE_REASON), false);
});

test('public collection status returns NORMAL for a recent successful run using service-role access', async () => {
  sawCollectorRunsServiceRole = false;
  sawCollectorRunsAnon = false;
  collectorRunsResponse = [{
    ...RUNS[0],
    result: 'SUCCESS',
    finished_at: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
    source_health: { 정상기관: { count: 1, status: 'OK', reason: '' } },
  }];
  collectorRunsHttpStatus = 200;

  const response = await fetch(`${appOrigin}/api/collection-status`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.state, 'NORMAL');
  assert.equal(payload.showBanner, false);
  assert.equal(sawCollectorRunsServiceRole, true);
  assert.equal(sawCollectorRunsAnon, false);
});

test('public collection status identifies an old run as STALE, not unavailable', async () => {
  const finishedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  collectorRunsResponse = [{
    ...RUNS[0],
    result: 'SUCCESS',
    finished_at: finishedAt,
    source_health: { 정상기관: { count: 1, status: 'OK', reason: '' } },
  }];
  collectorRunsHttpStatus = 200;

  const response = await fetch(`${appOrigin}/api/collection-status`);
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(payload.state, 'STALE');
  assert.equal(payload.message, '최근 수집 이후 다음 예정 실행 시간이 지났습니다.');
  assert.equal(payload.finishedAt, finishedAt);
  assert.equal(payload.stale, true);
});

test('public collection status sanitizes database failures as ERROR, not STALE', async () => {
  collectorRunsHttpStatus = 500;

  const response = await fetch(`${appOrigin}/api/collection-status`);
  const payload = await response.json();
  const serialized = JSON.stringify(payload);
  assert.equal(response.status, 503);
  assert.equal(payload.state, 'ERROR');
  assert.equal(payload.message, '현재 최신 수집 상태를 확인할 수 없습니다.');
  assert.equal(payload.stale, false);
  assert.equal(serialized.includes('test_database_error'), false);
  assert.equal(serialized.includes('internal test failure detail'), false);
});

test('logout clears the HttpOnly session cookie', async () => {
  const response = await fetch(`${appOrigin}/api/admin/logout`, {
    method: 'POST',
    headers: { Origin: appOrigin },
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('set-cookie') || '', /Max-Age=0/);
  assert.match(response.headers.get('set-cookie') || '', /HttpOnly/);
});
