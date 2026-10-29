import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { EventEmitter, once } from 'node:events';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createDatabase, rpc, TOKEN_A } from './fixtures/supportDatabase.mjs';
import { attachmentMigration } from './fixtures/supportAttachments.mjs';
import { cookieName } from '../src/lib/customer-auth/core.mjs';

const path = '/api/customer-admin/support/requests';
const cookie = `${cookieName('admin', true)}=${TOKEN_A}`;
const mailEvents = new EventEmitter();
const mailCalls = [];
const delivered = new Set();
let db, server, app, origin, serviceOrigin;
let mailStatus = 200;
let databaseFailure = false;

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  db = await createDatabase();
  await db.exec(attachmentMigration);
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks));
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/emails') {
      mailCalls.push({ headers: req.headers, body: input });
      if (mailStatus === 200) delivered.add(req.headers['idempotency-key']);
      res.writeHead(mailStatus).end(JSON.stringify({ id: 'local-mail-id' }));
      mailEvents.emit('mail');
      return;
    }
    if (req.headers.apikey !== 'local-service-key') { res.writeHead(401).end('{}'); return; }
    try {
      if (req.url === '/rest/v1/rpc/customer_auth_rpc') {
        const { rows } = await db.query('SELECT customer_auth.validate_session($1,$2) AS data', [input.payload.kind, input.payload.token_hash]);
        res.end(JSON.stringify(rows[0].data));
        return;
      }
      if (databaseFailure) { res.writeHead(500).end(JSON.stringify({ code: 'XX000' })); return; }
      const result = req.url === '/rest/v1/rpc/support_attachment_create_rpc'
        ? await db.transaction(async tx => {
          await tx.exec('SET LOCAL ROLE service_role');
          return (await tx.query('SELECT public.support_attachment_create_rpc($1::jsonb,$2::uuid) AS data', [JSON.stringify(input.payload), input.client_key])).rows[0].data;
        })
        : await rpc(db, 'customer', input.operation, input.payload);
      res.end(JSON.stringify(result));
    } catch (error) { res.writeHead(400).end(JSON.stringify({ code: error.code || 'XX000' })); }
  });
  serviceOrigin = await listen(server);
  const reservation = createServer();
  origin = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  app = spawn(process.execPath, ['--import', fileURLToPath(new URL('./fixtures/supportMailTransport.mjs', import.meta.url)), 'node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', new URL(origin).port], {
    cwd: new URL('..', import.meta.url), stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: 'production', SUPPORT_ENABLED: 'true', SUPPORT_ATTACHMENTS_ENABLED: 'true',
      CUSTOMER_AUTH_FOUNDATION_ENABLED: 'true', NEXT_PUBLIC_SUPABASE_URL: serviceOrigin,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-anon', SUPABASE_SERVICE_ROLE_KEY: 'local-service-key',
      SUPPORT_EMAIL_NOTIFICATIONS_ENABLED: 'true', RESEND_API_KEY: 'local-resend-key',
      SUPPORT_NOTIFICATION_FROM: 'sender@example.invalid', SUPPORT_NOTIFICATION_TO: 'operator@example.invalid',
      SUPPORT_TEST_MAIL_ORIGIN: serviceOrigin },
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Next readiness deadline exceeded')), 30000);
    app.once('exit', code => { clearTimeout(timer); reject(new Error(`Next exited ${code}`)); });
    app.stdout.on('data', chunk => { if (chunk.toString().includes('Ready')) { clearTimeout(timer); resolve(); } });
  });
});

after(async () => {
  if (app && app.exitCode === null) { const exited = once(app, 'exit'); app.kill(); await exited; }
  if (server) await new Promise(resolve => server.close(resolve));
  await db?.close();
});

const create = (body = { title: 'Local notification request', description: 'PRIVATE_DESCRIPTION' }, headers = {}) => fetch(origin + path, {
  method: 'POST', headers: { cookie, Origin: origin.replace('http:', 'https:'), 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});
const nextMail = () => once(mailEvents, 'mail', { signal: AbortSignal.timeout(10000) });

test('saved customer request sends a metadata notification after a successful HTTP response', async () => {
  // Given
  const notified = nextMail();
  // When
  const response = await create();
  const data = await response.json();
  await notified;
  // Then
  assert.equal(response.status, 201);
  assert.equal(mailCalls.at(-1).headers['idempotency-key'], `support-created/${data.request.id}`);
  assert.deepEqual(mailCalls.at(-1).body.to, ['operator@example.invalid']);
  assert.equal(JSON.stringify(mailCalls.at(-1).body).includes('PRIVATE_DESCRIPTION'), false);
});

test('saved request remains readable when the email provider rejects delivery', async () => {
  // Given
  mailStatus = 403;
  const notified = nextMail();
  // When
  const response = await create();
  const { request } = await response.json();
  await notified;
  // Then
  assert.equal(response.status, 201);
  const detail = await fetch(`${origin}${path}/${request.id}`, { headers: { cookie } });
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).request.id, request.id);
  mailStatus = 200;
});

test('creation replays use the same provider idempotency key and produce one delivery', async () => {
  // Given
  const headers = { 'x-support-request-key': '33333333-3333-4333-8333-333333333333' };
  const beforeDeliveries = delivered.size;
  let notified = nextMail();
  const first = await (await create(undefined, headers)).json();
  await notified;
  // When
  notified = nextMail();
  const retry = await (await create(undefined, headers)).json();
  await notified;
  // Then
  assert.equal(first.request.id, retry.request.id);
  assert.equal(delivered.size, beforeDeliveries + 1);
  assert.equal(mailCalls.at(-1).headers['idempotency-key'], mailCalls.at(-2).headers['idempotency-key']);
});

test('unauthorized invalid and failed database creates never reach the email provider', async () => {
  // Given
  const beforeCalls = mailCalls.length;
  // When
  const unauthorized = await create(undefined, { cookie: '' });
  const invalid = await create({ title: '', description: 'test' });
  databaseFailure = true;
  let failed;
  try { failed = await create(); } finally { databaseFailure = false; }
  // Then
  assert.equal(unauthorized.status, 401);
  assert.equal(invalid.status, 400);
  assert.equal(failed.status, 503);
  assert.equal(mailCalls.length, beforeCalls);
});
