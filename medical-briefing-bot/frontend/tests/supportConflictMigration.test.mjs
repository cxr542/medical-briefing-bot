import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabase, create, rpc, internalPayload, customerPayload } from './fixtures/supportDatabase.mjs';
import { attachmentMigration, conflictMigration } from './fixtures/supportAttachments.mjs';

test('conflict correction preserves existing requests, function identity, ACLs and security configuration', async () => {
  const db = await createDatabase();
  try {
    await db.exec(attachmentMigration);
    const { request } = await create(db);
    const metadata = `SELECT oid,proacl,prosecdef,proconfig FROM pg_proc WHERE oid IN (
      'support.admin_rpc(text,jsonb)'::regprocedure, 'support.attachment_rpc(text,text,jsonb)'::regprocedure,
      'public.support_attachment_create_rpc(jsonb,uuid)'::regprocedure, 'public.support_attachment_worker_rpc(text,jsonb)'::regprocedure) ORDER BY oid`;
    const before = await db.query(metadata);
    await db.exec(conflictMigration);
    assert.deepEqual((await db.query(metadata)).rows, before.rows);
    const detail = await rpc(db, 'customer', 'detail', customerPayload({ request_id: request.id }));
    assert.equal(detail.request.id, request.id);
    await assert.rejects(rpc(db, 'internal', 'note', internalPayload({ request_id: request.id, version: 2, body: 'stale' })), { code: 'PT409' });
    assert.equal((await rpc(db, 'internal', 'detail', internalPayload({ request_id: request.id }))).request.version, 1);
  } finally { await db.close(); }
});

test('unexpected function drift aborts the entire correction without partial replacements', async () => {
  const db = await createDatabase();
  try {
    await db.exec(attachmentMigration);
    await db.exec("CREATE OR REPLACE FUNCTION public.support_attachment_create_rpc(payload jsonb,client_key uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$");
    await assert.rejects(db.exec(conflictMigration), /Expected support conflict definition missing/);
    await db.exec('ROLLBACK');
    const { request } = await create(db);
    await assert.rejects(rpc(db, 'internal', 'note', internalPayload({ request_id: request.id, version: 2, body: 'stale' })), { code: '40001' });
  } finally { await db.close(); }
});
