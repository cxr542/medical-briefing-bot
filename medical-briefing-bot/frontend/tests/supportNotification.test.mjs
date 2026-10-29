import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import nodemailer from 'nodemailer';
import { SMTPServer } from 'smtp-server';
import { notifySupportCreated } from '../src/lib/support/notification.ts';
import { createDatabase, create } from './fixtures/supportDatabase.mjs';
import { notificationMigration, notificationStore } from './fixtures/supportNotificationDatabase.mjs';

let db;
before(async () => { db = await createDatabase(); await db.exec(notificationMigration); });
after(async () => db?.close());
function configure(t, overrides = {}) {
  t.mock.property(process, 'env', { ...process.env,
    SUPPORT_EMAIL_NOTIFICATIONS_ENABLED: 'true', GMAIL_APP_PASSWORD: 'aaaa bbbb cccc dddd',
    GMAIL_SMTP_USER: 'sender@example.invalid', SUPPORT_NOTIFICATION_TO: 'operator@example.invalid',
    SUPPORT_NOTIFICATION_SITE_URL: 'https://service.example.invalid', ...overrides,
  });
}
async function provider(t, { rejectAuth = false } = {}) {
  const messages = [], options = [], auth = [];
  const server = new SMTPServer({ secure: false, disabledCommands: ['STARTTLS'], allowInsecureAuth: true,
    onAuth(value, session, callback) {
      auth.push({ user: value.username, pass: value.password });
      callback(rejectAuth ? Object.assign(new Error('TEST_REJECTION'), { responseCode: 535 }) : null, { user: value.username });
    },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', chunk => chunks.push(chunk));
      stream.on('end', () => { messages.push(Buffer.concat(chunks).toString()); callback(); });
    },
  });
  server.listen(0, '127.0.0.1'); await once(server.server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { messages, options, auth, factory(config) {
    options.push(config);
    return nodemailer.createTransport({ ...config, host: '127.0.0.1', port: server.server.address().port, secure: false, ignoreTLS: true });
  } };
}

test('SMTP notification uses TLS Gmail configuration and sends metadata without the inquiry body', async t => {
  // Given
  configure(t); const smtp = await provider(t); const { request } = await create(db);
  request.title = 'Title\r\n<script>example</script>';
  request.description = 'PRIVATE_BODY_SENTINEL';
  // When
  const result = await notifySupportCreated(request, notificationStore(db), smtp.factory);
  // Then
  assert.deepEqual(result, { status: 'sent' });
  assert.equal(smtp.options[0].host, 'smtp.gmail.com'); assert.equal(smtp.options[0].port, 465); assert.equal(smtp.options[0].secure, true);
  assert.deepEqual(smtp.auth, [{ user: 'sender@example.invalid', pass: 'aaaabbbbccccdddd' }]);
  assert.equal(smtp.messages.length, 1);
  assert.match(smtp.messages[0], /To: operator@example.invalid/);
  assert.ok(smtp.messages[0].includes(`support-created.${request.id}@service.example.invalid`));
  assert.ok(smtp.messages[0].replace(/=\r\n/g, '').includes('https://service.example.invalid/admin/support'));
  assert.equal(smtp.messages[0].includes('PRIVATE_BODY_SENTINEL'), false);
  assert.equal(smtp.messages[0].includes('Content-Type: text/html'), false);
  assert.equal((await db.query('SELECT status FROM support.support_email_notifications WHERE request_id=$1', [request.id])).rows[0].status, 'accepted');
});

test('SMTP notification skips disabled or invalid configuration before claiming a request', async t => {
  // Given
  const smtp = await provider(t); const { request } = await create(db);
  for (const overrides of [{ SUPPORT_EMAIL_NOTIFICATIONS_ENABLED: '' }, { GMAIL_APP_PASSWORD: '' }, { GMAIL_SMTP_USER: 'bad' }, { SUPPORT_NOTIFICATION_SITE_URL: 'https://user:pass@example.invalid' }]) {
    configure(t, overrides);
    // When
    const result = await notifySupportCreated(request, notificationStore(db), smtp.factory);
    // Then
    assert.equal(result.status, overrides.SUPPORT_EMAIL_NOTIFICATIONS_ENABLED === '' ? 'disabled' : 'failed');
    assert.equal(smtp.messages.length, 0); t.mock.restoreAll();
  }
  assert.equal((await db.query('SELECT count(*)::int AS count FROM support.support_email_notifications WHERE request_id=$1', [request.id])).rows[0].count, 0);
});

test('concurrent SMTP notification calls claim one delivery in the database', async t => {
  // Given
  configure(t); const smtp = await provider(t); const { request } = await create(db);
  // When
  const results = await Promise.all([notifySupportCreated(request, notificationStore(db), smtp.factory), notifySupportCreated(request, notificationStore(db), smtp.factory)]);
  // Then
  assert.deepEqual(results.map(value => value.status).sort(), ['duplicate', 'sent']);
  assert.equal(smtp.messages.length, 1);
});

test('SMTP authentication rejection is recorded without automatic retry or exposed credentials', async t => {
  // Given
  configure(t); const smtp = await provider(t, { rejectAuth: true }); const { request } = await create(db);
  // When
  const result = await notifySupportCreated(request, notificationStore(db), smtp.factory);
  const replay = await notifySupportCreated(request, notificationStore(db), smtp.factory);
  // Then
  assert.deepEqual(result, { status: 'failed', reason: 'transport' }); assert.deepEqual(replay, { status: 'duplicate' });
  assert.equal(smtp.auth.length, 1); assert.equal(smtp.messages.length, 0);
  assert.equal((await db.query('SELECT status FROM support.support_email_notifications WHERE request_id=$1', [request.id])).rows[0].status, 'failed');
});

test('SMTP notification suppresses historical creation replays', async t => {
  // Given
  configure(t); const smtp = await provider(t); const { request } = await create(db);
  request.created_at = '2020-01-01T00:00:00Z';
  // When
  const result = await notifySupportCreated(request, notificationStore(db), smtp.factory);
  // Then
  assert.deepEqual(result, { status: 'expired' }); assert.equal(smtp.options.length, 0);
});

test('SMTP notification defaults to the requested Gmail account as sender and recipient', async t => {
  // Given
  configure(t, { GMAIL_SMTP_USER: undefined, SUPPORT_NOTIFICATION_TO: undefined });
  const smtp = await provider(t); const { request } = await create(db);
  // When
  const result = await notifySupportCreated(request, notificationStore(db), smtp.factory);
  // Then
  assert.equal(result.status, 'sent'); assert.equal(smtp.auth[0].user, 'cxr542@gmail.com');
  assert.match(smtp.messages[0], /To: cxr542@gmail.com/);
});

test('SMTP notification fails closed when database claim fails', async t => {
  // Given
  configure(t); const smtp = await provider(t); const { request } = await create(db);
  const store = { record: async () => { throw new Error('TEST_DATABASE_ERROR'); } };
  // When
  const result = await notifySupportCreated(request, store, smtp.factory);
  // Then
  assert.deepEqual(result, { status: 'failed', reason: 'database' }); assert.equal(smtp.options.length, 0);
});

test('notification tables and RPC are inaccessible to anonymous and authenticated roles', async () => {
  // Given / When
  const { rows } = await db.query("SELECT role, has_function_privilege(role,'public.support_email_notification_rpc(text,uuid)','EXECUTE') AS execute, has_table_privilege(role,'support.support_email_notifications','SELECT,INSERT,UPDATE') AS access FROM (VALUES ('anon'),('authenticated')) roles(role)");
  // Then
  for (const row of rows) { assert.equal(row.execute, false); assert.equal(row.access, false); }
});

test('a lost acknowledgement after SMTP acceptance never causes a second delivery', async t => {
  // Given
  configure(t); const smtp = await provider(t); const { request } = await create(db);
  const factory = options => {
    const transport = smtp.factory(options);
    return { close: () => transport.close(), sendMail: async message => {
      await transport.sendMail(message); throw new Error('TEST_LOST_ACKNOWLEDGEMENT');
    } };
  };
  // When
  const result = await notifySupportCreated(request, notificationStore(db), factory);
  const replay = await notifySupportCreated(request, notificationStore(db), factory);
  // Then
  assert.deepEqual(result, { status: 'failed', reason: 'transport' });
  assert.deepEqual(replay, { status: 'duplicate' }); assert.equal(smtp.messages.length, 1);
});

test('failed completion recording preserves the original claim against replay', async t => {
  // Given
  configure(t); const smtp = await provider(t); const { request } = await create(db);
  const store = notificationStore(db);
  const failing = { record: (operation, id) => operation === 'accepted' ? Promise.reject(new Error('TEST_RECORD_FAILURE')) : store.record(operation, id) };
  // When
  const result = await notifySupportCreated(request, failing, smtp.factory);
  const replay = await notifySupportCreated(request, store, smtp.factory);
  // Then
  assert.deepEqual(result, { status: 'failed', reason: 'database' });
  assert.deepEqual(replay, { status: 'duplicate' }); assert.equal(smtp.messages.length, 1);
});
