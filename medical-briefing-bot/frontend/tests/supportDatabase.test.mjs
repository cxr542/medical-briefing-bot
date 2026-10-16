import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createDatabase, create, rpc, customerPayload, internalPayload, migration, ADMIN_A } from './fixtures/supportDatabase.mjs';
import { tokenHash } from '../src/lib/customer-auth/core.mjs';
import { readFile } from 'node:fs/promises';

let db;
before(async () => { db = await createDatabase(); });
after(async () => { await db?.close(); });

test('customer request owner is derived from the authenticated session', async () => {
  const { request } = await create(db);
  const { rows } = await db.query('SELECT requester_admin_id FROM support.support_requests WHERE id=$1', [request.id]);
  assert.equal(rows[0].requester_admin_id, ADMIN_A);
  assert.equal(request.requester_admin_id, undefined);
  await assert.rejects(rpc(db, 'customer', 'create', customerPayload({ title: 'forged', description: 'body', requester_admin_id: ADMIN_A })), { code: '22023' });
});

test('customer RPC denies expired revoked inactive and rotated sessions', async () => {
  for (const [table,field,value] of [
    ['customer_sessions','expires_at',"now()-interval '1 second'"],
    ['customer_sessions','revoked_at','now()'],
    ['customer_admins','active','false'],
    ['customer_admins','credential_version','2'],
    ['customer_admins','session_version','2'],
  ]) {
    await db.transaction(async tx => {
      await tx.exec(`UPDATE customer_auth.${table} SET ${field}=${value}`);
      await tx.exec('SET LOCAL ROLE service_role');
      await assert.rejects(tx.query("SELECT public.customer_support_rpc('list',$1::jsonb)", [JSON.stringify(customerPayload())]), { code: '42501' });
      throw new Error('ROLLBACK_FIXTURE');
    }).catch(error => { assert.equal(error.message, 'ROLLBACK_FIXTURE'); });
  }
});

test('unknown and ordinary user sessions cannot authorize customer support', async () => {
  await assert.rejects(rpc(db, 'customer', 'list', { admin_token_hash: tokenHash('z'.repeat(43)) }), { code: '42501' });
  await db.transaction(async tx => {
    await tx.exec("UPDATE customer_auth.customer_sessions SET kind='user'");
    await tx.exec('SET LOCAL ROLE service_role');
    await assert.rejects(tx.query("SELECT public.customer_support_rpc('list',$1::jsonb)", [JSON.stringify(customerPayload())]), { code: '42501' });
    throw new Error('ROLLBACK_FIXTURE');
  }).catch(error => { assert.equal(error.message, 'ROLLBACK_FIXTURE'); });
});

test('notes and internal audit data never enter the customer RPC detail', async () => {
  const { request } = await create(db);
  await rpc(db, 'internal', 'note', internalPayload({ request_id: request.id, body: 'PRIVATE_SENTINEL', version: 1 }));
  await rpc(db, 'internal', 'comment', internalPayload({ request_id: request.id, body: 'PUBLIC_ANSWER', version: 2 }));
  const customer = await rpc(db, 'customer', 'detail', customerPayload({ request_id: request.id }));
  assert.equal(customer.comments[0].body, 'PUBLIC_ANSWER');
  assert.equal(JSON.stringify(customer).includes('PRIVATE_SENTINEL'), false);
  assert.deepEqual(Object.keys(customer).sort(), ['comments','comments_total','page','page_size','request']);
  const internal = await rpc(db, 'internal', 'detail', internalPayload({ request_id: request.id }));
  assert.equal(internal.notes[0].body, 'PRIVATE_SENTINEL');
  assert.equal(internal.audit.length, 3);
});

test('stale concurrent versions produce one update and one conflict with atomic history', async () => {
  const { request } = await create(db);
  const results = await Promise.allSettled(['reviewing','on_hold'].map(status => rpc(db, 'internal', 'status', internalPayload({ request_id: request.id, status, reason: 'triage', version: 1 }))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.find(r => r.status === 'rejected').reason.code, '40001');
  const detail = await rpc(db, 'internal', 'detail', internalPayload({ request_id: request.id }));
  assert.equal(detail.request.version, 2);
  assert.equal(detail.history.length, 2);
  assert.equal(detail.audit.filter(e => e.action === 'status_changed').length, 1);
});

test('invalid transition and failed audit insert leave the request unchanged', async () => {
  const { request } = await create(db);
  await assert.rejects(rpc(db, 'internal', 'status', internalPayload({ request_id: request.id, status: 'completed', reason: 'invalid jump', version: 1 })), { code: '22023' });
  await db.exec("CREATE FUNCTION support.test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'test audit failure'; END $$; CREATE TRIGGER test_fail_audit BEFORE INSERT ON support.support_audit_events FOR EACH ROW EXECUTE FUNCTION support.test_fail_audit();");
  try {
    await assert.rejects(rpc(db, 'internal', 'status', internalPayload({ request_id: request.id, status: 'reviewing', reason: 'triage', version: 1 })), /test audit failure/);
  } finally {
    await db.exec('DROP TRIGGER test_fail_audit ON support.support_audit_events; DROP FUNCTION support.test_fail_audit();');
  }
  const detail = await rpc(db, 'internal', 'detail', internalPayload({ request_id: request.id }));
  assert.equal(detail.request.status, 'received');
  assert.equal(detail.history.length, 1);
  assert.equal(detail.audit.length, 1);
});

test('anon and authenticated have no schema table or RPC access', async () => {
  for (const role of ['anon','authenticated']) {
    const { rows } = await db.query(`SELECT has_schema_privilege($1,'support','USAGE') AS schema_access,
      has_function_privilege($1,'public.customer_support_rpc(text,jsonb)','EXECUTE') AS customer_rpc,
      has_function_privilege($1,'public.admin_support_rpc(text,jsonb)','EXECUTE') AS admin_rpc`, [role]);
    assert.deepEqual(rows[0], { schema_access: false, customer_rpc: false, admin_rpc: false });
    for (const statement of ['SELECT * FROM support.support_requests', "SELECT public.customer_support_rpc('list','{}')", "SELECT public.admin_support_rpc('list','{}')"]) {
      await assert.rejects(db.transaction(async tx => { await tx.exec(`SET LOCAL ROLE ${role}`); await tx.query(statement); }), { code: '42501' });
    }
  }
  const { rows } = await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='support' AND relkind='r'");
  assert.equal(rows.length, 5);
  assert.ok(rows.every(r => r.relrowsecurity && r.relforcerowsecurity));
});

test('reapplying migration fails without changing existing support data', async () => {
  const before = await rpc(db, 'internal', 'list', internalPayload());
  await assert.rejects(db.exec(migration), /already applied/);
  await db.exec('ROLLBACK');
  const after = await rpc(db, 'internal', 'list', internalPayload());
  assert.deepEqual(after, before);
});

test('failed migration rolls back all new objects and preserves existing authentication', async () => {
  const isolated = await createDatabase({ apply: false });
  try {
    const broken = migration.replace('GRANT USAGE ON SCHEMA support TO service_role;', 'GRANT USAGE ON SCHEMA support TO nonexistent_test_role;');
    await assert.rejects(isolated.exec(broken), { code: '42704' });
    await isolated.exec('ROLLBACK');
    assert.equal((await isolated.query("SELECT to_regnamespace('support') AS schema")).rows[0].schema,null);
    assert.equal((await isolated.query('SELECT count(*)::integer AS count FROM customer_auth.customer_admins')).rows[0].count,2);
    await isolated.exec(migration);
    assert.equal((await create(isolated)).request.status,'received');
  } finally { await isolated.close(); }
});

test('empty rollback removes only support and populated rollback refuses data loss', async () => {
  const rollback = await readFile(new URL('../../supabase/rollback/support_foundation_empty_only.sql',import.meta.url),'utf8');
  const isolated = await createDatabase();
  try {
    await isolated.exec(rollback);
    assert.equal((await isolated.query("SELECT to_regnamespace('support') AS schema")).rows[0].schema,null);
    assert.equal((await isolated.query('SELECT count(*)::integer AS count FROM customer_auth.customer_admins')).rows[0].count,2);
    await isolated.exec(migration);
    const { request } = await create(isolated);
    await assert.rejects(isolated.exec(rollback), /Support contains data/);
    await isolated.exec('ROLLBACK');
    const found = await rpc(isolated,'customer','detail',customerPayload({request_id:request.id}));
    assert.equal(found.request.id,request.id);
  } finally { await isolated.close(); }
});

test('RLS denies rows to a non-bypass role even if SELECT is accidentally granted', async () => {
  await create(db);
  await db.exec('CREATE ROLE support_rls_probe; GRANT USAGE ON SCHEMA support TO support_rls_probe; GRANT SELECT ON support.support_requests TO support_rls_probe;');
  const result = await db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE support_rls_probe');
    return tx.query('SELECT count(*)::integer AS count FROM support.support_requests');
  });
  assert.equal(result.rows[0].count,0);
});

test('completion reopening and cancellation maintain closed timestamps and transition reasons', async () => {
  const { request } = await create(db);
  let current = request;
  for (const status of ['reviewing','in_progress','waiting_customer','completed','reviewing','on_hold','in_progress','cancelled']) {
    const result = await rpc(db,'internal','status',internalPayload({request_id:request.id,status,reason:`Move to ${status}`,version:current.version}));
    current = result.request;
    assert.equal(current.status,status);
    assert.equal(current.closed_at !== null,['completed','cancelled'].includes(status));
  }
  const detail = await rpc(db,'internal','detail',internalPayload({request_id:request.id}));
  assert.equal(detail.history_total,9);
  assert.equal(detail.audit_total,9);
  assert.equal(detail.history[0].reason,'Move to cancelled');
  assert.equal(detail.history[0].previous_status,'in_progress');
  assert.equal(detail.history[0].actor_type,'internal_admin');
  await assert.rejects(rpc(db,'internal','status',internalPayload({request_id:request.id,status:'reviewing',reason:'reopen',version:current.version})),{code:'22023'});
});
