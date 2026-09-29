import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  ADMIN_PASSWORD_MIN_BYTES,
  ADMIN_SESSION_COOKIE_NAME,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  getAdminSessionToken,
  hasSameOrigin,
  isAdminCredentialConfigured,
  isAdminRequestAuthorized,
  serializeAdminSessionCookie,
  serializeClearedAdminSessionCookie,
  verifyAdminCredential,
  verifyAdminSessionToken,
} from '../frontend/src/lib/adminAuth.mjs';
import {
  formatKstTimestamp,
  formatSourceHealthSummary,
} from '../frontend/src/lib/adminMonitoringFormatters.mjs';

const TEST_PASSWORD = `test-only-${'x'.repeat(ADMIN_PASSWORD_MIN_BYTES)}`;
const NOW = Date.parse('2026-09-28T00:00:00.000Z');

test('missing or short Admin credential fails closed', () => {
  assert.equal(isAdminCredentialConfigured(''), false);
  assert.equal(isAdminCredentialConfigured('short'), false);
  assert.equal(verifyAdminCredential(TEST_PASSWORD, undefined), false);
});

test('wrong credential fails and correct credential creates a signed session', () => {
  assert.equal(isAdminCredentialConfigured(TEST_PASSWORD), true);
  assert.equal(verifyAdminCredential('wrong-password', TEST_PASSWORD), false);
  assert.equal(verifyAdminCredential(TEST_PASSWORD, TEST_PASSWORD), true);

  const token = createAdminSessionToken(TEST_PASSWORD, NOW);
  assert.equal(typeof token, 'string');
  assert.equal(verifyAdminSessionToken(token, TEST_PASSWORD, NOW), true);
  assert.equal(verifyAdminSessionToken(token, 'different-test-password'.padEnd(ADMIN_PASSWORD_MIN_BYTES, 'x'), NOW), false);
});

test('tampered and expired sessions are rejected', () => {
  const token = createAdminSessionToken(TEST_PASSWORD, NOW);
  assert.equal(verifyAdminSessionToken(`${token}x`, TEST_PASSWORD, NOW), false);
  assert.equal(verifyAdminSessionToken(token, TEST_PASSWORD, NOW + ADMIN_SESSION_TTL_SECONDS * 1000), false);
});

test('monitoring authorization rejects missing cookies and accepts a valid signed cookie', () => {
  const token = createAdminSessionToken(TEST_PASSWORD, NOW);
  const noSession = new Request('https://medical-briefing.example/api/admin/monitoring');
  const validSession = new Request('https://medical-briefing.example/api/admin/monitoring', {
    headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token}` },
  });

  const originalPassword = process.env.ADMIN_PASSWORD;
  process.env.ADMIN_PASSWORD = TEST_PASSWORD;
  try {
    assert.equal(isAdminRequestAuthorized(noSession, NOW), false);
    assert.equal(isAdminRequestAuthorized(validSession, NOW), true);
    assert.equal(isAdminRequestAuthorized(new Request(validSession.url, {
      headers: { cookie: `${ADMIN_SESSION_COOKIE_NAME}=${token.slice(0, -1)}x` },
    }), NOW), false);
  } finally {
    if (originalPassword === undefined) delete process.env.ADMIN_PASSWORD;
    else process.env.ADMIN_PASSWORD = originalPassword;
  }
});

test('login requires same origin and session cookies are HttpOnly, SameSite and production Secure', () => {
  const sameOrigin = new Request('https://medical-briefing.example/api/admin/login', {
    method: 'POST',
    headers: { origin: 'https://medical-briefing.example' },
  });
  const crossOrigin = new Request(sameOrigin.url, {
    method: 'POST',
    headers: { origin: 'https://attacker.example' },
  });
  assert.equal(hasSameOrigin(sameOrigin), true);
  assert.equal(hasSameOrigin(crossOrigin), false);
  assert.equal(hasSameOrigin(new Request(sameOrigin.url, { method: 'POST' })), false);

  const activeCookie = serializeAdminSessionCookie('test-token', true);
  assert.match(activeCookie, /HttpOnly/);
  assert.match(activeCookie, /Secure/);
  assert.match(activeCookie, /SameSite=Lax/);
  assert.match(activeCookie, /Path=\//);
  assert.match(activeCookie, new RegExp(`^${ADMIN_SESSION_COOKIE_NAME}=`));

  const clearedCookie = serializeClearedAdminSessionCookie(true);
  assert.match(clearedCookie, /Max-Age=0/);
  assert.match(clearedCookie, /HttpOnly/);
  assert.equal(getAdminSessionToken(`other=value; ${activeCookie.split(';')[0]}`), 'test-token');
});

test('production login origin must be HTTPS and match the request host', () => {
  const originalEnvironment = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const sameHost = new Request('https://medical-briefing.example/api/admin/login', {
      method: 'POST',
      headers: {
        origin: 'https://medical-briefing.example',
        host: 'medical-briefing.example',
      },
    });
    const httpOrigin = new Request(sameHost.url, {
      method: 'POST',
      headers: { origin: 'http://medical-briefing.example', host: 'medical-briefing.example' },
    });
    const differentHost = new Request(sameHost.url, {
      method: 'POST',
      headers: { origin: 'https://attacker.example', host: 'medical-briefing.example' },
    });

    assert.equal(hasSameOrigin(sameHost), true);
    assert.equal(hasSameOrigin(httpOrigin), false);
    assert.equal(hasSameOrigin(differentHost), false);
  } finally {
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});

test('Admin absolute timestamps stay KST even when process timezone is UTC', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'UTC';
  try {
    assert.equal(formatKstTimestamp('2026-09-27T16:07:08.000Z'), '2026-09-28 01:07:08 KST');
    assert.equal(formatKstTimestamp('invalid'), '기록 없음');
  } finally {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  }
});

test('source health summary is compact and highlights warnings/failures', () => {
  assert.equal(formatSourceHealthSummary({ a: { status: 'OK' }, b: { status: 'OK' } }), 'OK 2');
  assert.equal(formatSourceHealthSummary({
    a: { status: 'OK' },
    b: { status: 'WARN' },
    c: { status: 'FAILED' },
  }), 'OK 1 / WARN 1 / FAILED 1');
  assert.equal(formatSourceHealthSummary({}), 'source health 없음');
  assert.equal(formatSourceHealthSummary(null), 'source health 없음');
});

test('Admin client source contains no credential check or direct Monitoring query', async () => {
  const adminPage = await readFile(new URL('../frontend/src/app/admin/page.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(adminPage, /ADMIN_PASSWORD|NEXT_PUBLIC_ADMIN_PASSWORD|SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(adminPage, /from\(['"]collector_runs['"]\)/);
  assert.doesNotMatch(adminPage, /password\.(?:trim|toLowerCase)\(\)\s*===/);

  const serverClient = await readFile(new URL('../frontend/src/lib/adminSupabase.ts', import.meta.url), 'utf8');
  assert.match(serverClient, /import ['"]server-only['"]/);
  assert.match(serverClient, /SUPABASE_SERVICE_ROLE_KEY/);
});
