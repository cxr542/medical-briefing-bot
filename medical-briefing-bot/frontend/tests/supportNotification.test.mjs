import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import ky from 'ky';
import { notifySupportCreated } from '../src/lib/support/notification.ts';

const request = () => ({
  id: '11111111-1111-4111-8111-111111111111', request_number: 42,
  title: '첨부 오류\r\n<script>example</script>', description: 'PRIVATE_BODY_SENTINEL',
  priority: 'high', status: 'received', version: 1,
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), closed_at: null,
});

function configure(t, overrides = {}) {
  t.mock.property(process, 'env', { ...process.env,
    SUPPORT_EMAIL_NOTIFICATIONS_ENABLED: 'true', RESEND_API_KEY: 'test-only-key',
    SUPPORT_NOTIFICATION_FROM: 'support@example.invalid', SUPPORT_NOTIFICATION_TO: 'operator@example.invalid',
    SUPPORT_NOTIFICATION_SITE_URL: 'https://service.example.invalid', ...overrides,
  });
}

async function provider(t, statuses = [200]) {
  const calls = [];
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    calls.push({ headers: req.headers, body: JSON.parse(Buffer.concat(chunks)), path: req.url });
    res.writeHead(statuses[Math.min(calls.length - 1, statuses.length - 1)], { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ id: 'test-email-id' }));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const http = ky.create({ fetch: input => {
    assert.equal(new URL(input.url).origin, 'https://api.resend.com');
    return fetch(new Request(`http://127.0.0.1:${server.address().port}/emails`, input));
  } });
  return { http, calls };
}

test('notification sends only metadata to the configured operator when enabled', async t => {
  // Given
  configure(t);
  const { http, calls } = await provider(t);
  const created = request();
  // When
  const result = await notifySupportCreated(created, http);
  // Then
  assert.deepEqual(result, { status: 'sent' });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].body.to, ['operator@example.invalid']);
  assert.equal(calls[0].body.from, 'support@example.invalid');
  assert.equal(calls[0].headers.authorization, 'Bearer test-only-key');
  assert.equal(calls[0].headers['idempotency-key'], `support-created/${created.id}`);
  assert.equal(calls[0].body.subject.includes('\n'), false);
  assert.ok(calls[0].body.text.includes('https://service.example.invalid/admin/support'));
  assert.equal(JSON.stringify(calls[0].body).includes('PRIVATE_BODY_SENTINEL'), false);
  assert.equal('html' in calls[0].body, false);
});

test('notification does not call the provider when disabled or misconfigured', async t => {
  // Given
  const { http, calls } = await provider(t);
  for (const overrides of [
    { SUPPORT_EMAIL_NOTIFICATIONS_ENABLED: '' }, { RESEND_API_KEY: '' },
    { SUPPORT_NOTIFICATION_FROM: 'bad' }, { SUPPORT_NOTIFICATION_SITE_URL: 'https://user:password@example.invalid' },
  ]) {
    const child = t.mock;
    configure(t, overrides);
    // When
    const result = await notifySupportCreated(request(), http);
    // Then
    assert.equal(result.status, overrides.SUPPORT_EMAIL_NOTIFICATIONS_ENABLED === '' ? 'disabled' : 'failed');
    assert.equal(calls.length, 0);
    child.restoreAll();
  }
});

test('notification retries a transient provider failure with an unchanged payload and idempotency key', async t => {
  // Given
  configure(t);
  const { http, calls } = await provider(t, [503, 200]);
  // When
  const result = await notifySupportCreated(request(), http);
  // Then
  assert.deepEqual(result, { status: 'sent' });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});

test('notification reports permanent rejection without leaking provider details or retrying', async t => {
  // Given
  configure(t);
  const { http, calls } = await provider(t, [403]);
  // When
  const result = await notifySupportCreated(request(), http);
  // Then
  assert.deepEqual(result, { status: 'failed', reason: 'provider', httpStatus: 403 });
  assert.equal(calls.length, 1);
});

test('notification stops retrying after a second provider failure', async t => {
  // Given
  configure(t);
  const { http, calls } = await provider(t, [503]);
  // When
  const result = await notifySupportCreated(request(), http);
  // Then
  assert.deepEqual(result, { status: 'failed', reason: 'provider', httpStatus: 503 });
  assert.equal(calls.length, 2);
});

test('notification skips old create replays after the provider deduplication window', async t => {
  // Given
  configure(t);
  const { http, calls } = await provider(t);
  const created = { ...request(), created_at: '2020-01-01T00:00:00Z' };
  // When
  const result = await notifySupportCreated(created, http);
  // Then
  assert.deepEqual(result, { status: 'expired' });
  assert.equal(calls.length, 0);
});

test('notification uses the requested administrator address when no recipient override exists', async t => {
  // Given
  configure(t, { SUPPORT_NOTIFICATION_TO: undefined });
  const { http, calls } = await provider(t);
  // When
  await notifySupportCreated(request(), http);
  // Then
  assert.deepEqual(calls[0].body.to, ['cxr542@gmail.com']);
});

test('notification returns a safe failure when the transport cannot connect', async t => {
  // Given
  configure(t);
  const http = ky.create({ fetch: async () => { throw new TypeError('fetch failed'); } });
  // When
  const result = await notifySupportCreated(request(), http);
  // Then
  assert.deepEqual(result, { status: 'failed', reason: 'transport' });
});
