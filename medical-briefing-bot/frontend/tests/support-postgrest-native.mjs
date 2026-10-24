import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { authFoundation, migration, ADMIN_A, TOKEN_A, customerPayload, internalPayload } from './fixtures/supportDatabase.mjs';
import { attachmentMigration, metadata, sha, pdf } from './fixtures/supportAttachments.mjs';
import { tokenHash } from '../src/lib/customer-auth/core.mjs';

const execute = promisify(execFile);
const suffix = randomUUID();
const network = `support-conflict-${suffix}`;
const database = `support-db-${suffix}`;
const rest = `support-rest-${suffix}`;
const correction = await readFile(new URL('../../supabase/migrations/20261019041429_support_conflict_sqlstate.sql', import.meta.url), 'utf8');
const secret = randomBytes(32).toString('hex');
const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
function jwt(role) {
  const claims = Buffer.from(JSON.stringify({ role, exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const value = `${header}.${claims}`;
  return `${value}.${createHmac('sha256', secret).update(value).digest('base64url')}`;
}
let origin;
const started = [];
const sql = async query => (await execute('docker', ['exec', database, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-c', query], { timeout: 15000 })).stdout.trim();
async function call(name, args, role = 'service_role') {
  const response = await fetch(`${origin}/rpc/${name}`, { method: 'POST', signal: AbortSignal.timeout(3000), headers: { authorization: `Bearer ${jwt(role)}`, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  return { status: response.status, data: await response.json() };
}
const attachment = (operation, payload) => call('support_attachment_rpc', { audience: 'customer', operation, payload });
const worker = (operation, payload) => call('support_attachment_worker_rpc', { operation, payload });
async function create() {
  const result = await call('customer_support_rpc', { operation: 'create', payload: customerPayload({ title: 'Native conflict test', description: 'Synthetic only', priority: 'normal' }) });
  assert.equal(result.status, 200); return result.data.request.id;
}
function conflict(result) { assert.equal(result.status, 409); assert.equal(result.data.code, 'PT409'); }

before(async () => {
  await execute('docker', ['network', 'create', network]); started.push('network');
  await execute('docker', ['run', '-d', '--name', database, '--network', network, '--network-alias', 'db', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17.6-alpine'], { timeout: 120000 }); started.push(database);
  for (let attempt = 0; ; attempt++) {
    try { await execute('docker', ['exec', database, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']); break; }
    catch (error) { if (attempt === 99) throw error; await delay(100); }
  }
  await sql(authFoundation);
  await sql(`INSERT INTO customer_auth.customer_admins(id) VALUES ('${ADMIN_A}'); INSERT INTO customer_auth.customer_sessions(token_hash,kind,admin_id,expires_at) VALUES ('${tokenHash(TOKEN_A)}','admin','${ADMIN_A}',now()+interval '1 hour')`);
  await sql(migration); await sql(attachmentMigration); await sql(correction);
  await execute('docker', ['run', '-d', '--name', rest, '--network', network, '-p', '127.0.0.1::3000', '-e', 'PGRST_DB_URI=postgres://postgres@db:5432/postgres', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${secret}`, 'ghcr.io/supabase/postgrest:v14.5'], { timeout: 120000 }); started.push(rest);
  const mapping = JSON.parse((await execute('docker', ['inspect', rest])).stdout)[0].NetworkSettings.Ports['3000/tcp'][0];
  assert.equal(mapping.HostIp, '127.0.0.1'); origin = `http://127.0.0.1:${mapping.HostPort}`;
  for (let attempt = 0; ; attempt++) {
    try { const response = await fetch(origin, { signal: AbortSignal.timeout(1000) }); await response.body?.cancel(); if (response.status === 200) break; }
    catch (error) { if (attempt === 99) throw error; }
    if (attempt === 99) throw new Error('PostgREST readiness deadline'); await delay(100);
  }
});
after(async () => {
  for (const name of started.reverse()) {
    if (name === 'network') await execute('docker', ['network', 'rm', network]);
    else await execute('docker', ['rm', '-f', name]);
  }
});

test('PostgREST 14 returns one successful update and immediate 409 for stale concurrent version', async () => {
  const request_id = await create();
  const results = await Promise.all(['reviewing', 'on_hold'].map(status => call('admin_support_rpc', { operation: 'status', payload: internalPayload({ request_id, status, reason: 'triage', version: 1 }) })));
  assert.equal(results.filter(result => result.status === 200).length, 1);
  conflict(results.find(result => result.status !== 200));
  assert.equal(await sql(`SELECT version FROM support.support_requests WHERE id='${request_id}'`), '2');
  assert.equal(await sql(`SELECT count(*) FROM support.support_status_history WHERE request_id='${request_id}'`), '2');
});

test('PostgREST 14 preserves request retry identity and rejects changed retry payload promptly', async () => {
  const client_key = randomUUID(); const payload = customerPayload({ title: 'Retry', description: 'Same request' });
  const first = await call('support_attachment_create_rpc', { client_key, payload });
  const retry = await call('support_attachment_create_rpc', { client_key, payload });
  assert.equal(first.status, 200); assert.equal(retry.data.request.id, first.data.request.id);
  conflict(await call('support_attachment_create_rpc', { client_key, payload: { ...payload, title: 'Changed' } }));
});

test('PostgREST 14 rejects duplicate metadata, duplicate file and busy or forged chunk leases promptly', async () => {
  const payload = metadata(await create());
  const first = await attachment('prepare', payload); assert.equal(first.status, 200);
  payload.attachment_id = first.data.id;
  conflict(await attachment('prepare', { ...payload, bytes: pdf.length + 1 }));
  conflict(await attachment('prepare', { ...payload, client_key: randomUUID() }));
  const part = { ...payload, part: 0, bytes: pdf.length, sha256: sha(pdf) };
  const claimed = await attachment('part', part); assert.equal(claimed.status, 200);
  conflict(await attachment('part', part));
  conflict(await attachment('part_done', { ...part, lease: randomUUID() }));
  assert.equal((await attachment('part_done', { ...part, lease: claimed.data.lease })).status, 200);
  conflict(await attachment('part', { ...part, sha256: sha('changed') }));
});

test('PostgREST 14 rejects stale and duplicate scan results without changing the accepted verdict', async () => {
  const payload = metadata(await create()); const prepared = await attachment('prepare', payload);
  payload.attachment_id = prepared.data.id;
  const part = await attachment('part', { ...payload, part: 0, bytes: pdf.length, sha256: sha(pdf) });
  await attachment('part_done', { ...payload, part: 0, lease: part.data.lease });
  await attachment('complete', payload);
  const claimed = await worker('claim', {}); assert.equal(claimed.data.id, prepared.data.id);
  const result = { attachment_id: prepared.data.id, lease: claimed.data.scan_lease, sha256: payload.sha256, status: 'infected' };
  conflict(await worker('finish', { ...result, lease: randomUUID() }));
  assert.equal((await worker('finish', result)).status, 200);
  conflict(await worker('finish', result));
  assert.equal(await sql(`SELECT scan_status FROM support.support_attachments WHERE id='${prepared.data.id}'`), 'infected');
});

test('PostgREST 14 keeps reservation count, ownership and public privileges unchanged', async () => {
  const request_id = await create();
  const results = await Promise.all(Array.from({ length: 8 }, (_, index) => attachment('prepare', metadata(request_id, Buffer.from(`file-${index}`)))));
  assert.equal(results.filter(result => result.status === 200).length, 5);
  assert.equal(results.filter(result => result.status === 400).length, 3);
  assert.equal((await call('support_attachment_rpc', { audience: 'customer', operation: 'list', payload: customerPayload({ request_id }) }, 'anon')).status, 401);
  assert.equal((await attachment('list', { request_id, admin_token_hash: sha('invalid') })).status, 403);
});
