import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase, create, customerPayload, TOKEN_B, internalPayload } from './fixtures/supportDatabase.mjs';
import { attachmentMigration, attachmentRpc as rpc, workerRpc, metadata, sha, pdf, MockStorage, mockScanner, uploaded } from './fixtures/supportAttachments.mjs';
import { scanNext } from '../src/lib/support/attachments/worker.mjs';
import { validateFile } from '../src/lib/support/attachments/validation.mjs';
import { checkedPath, storageAdapter } from '../src/lib/support/attachments/storage.mjs';
import { clamAvScanner } from '../src/lib/support/attachments/scanner.mjs';
import { prepareAttachment } from '../src/lib/support/attachments/contract.ts';
import { cleanupAttachments } from '../src/lib/support/attachments/cleanup.mjs';
let db;
before(async () => { db = await createDatabase(); await db.exec(attachmentMigration); });
after(async () => { await db?.close(); });
test('metadata validates size, extension, MIME, path and control characters', () => {
  const good = metadata(randomUUID()); delete good.request_id; delete good.admin_token_hash; delete good.token_hash;
  assert.ok(prepareAttachment.safeParse(good).success);
  for (const patch of [{ bytes: 10485761 }, { bytes: 0 }, { original_name: '../test.pdf' }, { original_name: 'test.pdf.exe' }, { mime: 'image/png' }, { original_name: 'test\r\n.pdf' }, { sha256: 'wrong' }]) assert.equal(prepareAttachment.safeParse({ ...good, ...patch }).success, false);
});
test('reservation is idempotent, rejects mismatch and enforces five active slots', async () => {
  const { request } = await create(db); const payload = metadata(request.id);
  const first = await rpc(db, 'customer', 'prepare', payload);
  assert.equal((await rpc(db, 'customer', 'prepare', { ...payload, token_hash: sha('new') })).id, first.id);
  await assert.rejects(rpc(db, 'customer', 'prepare', { ...payload, bytes: 5 }), { code: '40001' });
  await assert.rejects(rpc(db, 'customer', 'prepare', { ...payload, client_key: randomUUID() }), { code: '40001' });
  for (let i = 0; i < 4; i++) await rpc(db, 'customer', 'prepare', metadata(request.id, Buffer.from(`file-${i}`)));
  await assert.rejects(rpc(db, 'customer', 'prepare', metadata(request.id, Buffer.from('sixth'))), { code: '22023' });
});
test('customer ownership, internal actor auth and public projections remain separate', async () => {
  const { request } = await create(db); const payload = metadata(request.id);
  await rpc(db, 'customer', 'prepare', payload);
  await assert.rejects(rpc(db, 'customer', 'list', customerPayload({ request_id: request.id }, TOKEN_B)), { code: 'P0002' });
  await assert.rejects(rpc(db, 'internal', 'list', { request_id: request.id }), { code: '42501' });
  const list = await rpc(db, 'internal', 'list', internalPayload({ request_id: request.id }));
  assert.deepEqual(Object.keys(list.attachments[0]).sort(), ['bytes','created_at','id','mime','original_name','scan_status','upload_status']);
});
test('expired and rotated grants fail, incomplete uploads fail and part leases prevent races', async () => {
  const { request } = await create(db); const payload = metadata(request.id);
  const item = await rpc(db, 'customer', 'prepare', payload); payload.attachment_id = item.id;
  await assert.rejects(rpc(db, 'customer', 'complete', payload), { code: '22023' });
  const partPayload = { ...payload, part: 0, bytes: pdf.length, sha256: sha(pdf) };
  const part = await rpc(db, 'customer', 'part', partPayload);
  await assert.rejects(rpc(db, 'customer', 'part', partPayload), { code: '40001' });
  await assert.rejects(rpc(db, 'customer', 'part_done', { ...partPayload, lease: randomUUID() }), { code: '40001' });
  await rpc(db, 'customer', 'part_done', { ...partPayload, lease: part.lease });
  assert.deepEqual(await rpc(db, 'customer', 'part', partPayload), { ready: true });
  await assert.rejects(rpc(db, 'customer', 'part', { ...partPayload, sha256: sha('different') }), { code: '40001' });
  await db.query("UPDATE support.support_attachments SET expires_at=now()-interval '1 second' WHERE id=$1", [item.id]);
  await assert.rejects(rpc(db, 'customer', 'complete', payload), { code: '42501' });
  await rpc(db, 'customer', 'prepare', { ...payload, token_hash: sha('rotated') });
  await assert.rejects(rpc(db, 'customer', 'complete', payload), { code: '42501' });
  await rpc(db, 'customer', 'complete', { ...payload, token_hash: sha('rotated') });
  await db.query('UPDATE support.support_attachments SET deleted_at=now() WHERE id=$1', [item.id]);
});
test('scanner is fail closed and only clean files can be downloaded; deletion invalidates access', async () => {
  assert.equal(clamAvScanner({}).configured, false);
  await assert.rejects(scanNext({ scanner: clamAvScanner({}), rpc() { assert.fail('Must not claim without scanner'); } }), /not configured/);
  for (const verdict of ['clean', 'infected', new Error('scanner offline')]) {
    const storage = new MockStorage(); const { request } = await create(db);
    const payload = await uploaded(db, request.id, storage);
    for (const audience of ['customer','internal']) await assert.rejects(rpc(db, audience, 'download', audience === 'customer' ? payload : internalPayload(payload)), { code: '55000' });
    await scanNext({ storage, scanner: mockScanner(verdict), rpc: (op, value) => workerRpc(db, op, value) });
    const row = (await db.query('SELECT * FROM support.support_attachments WHERE id=$1', [payload.attachment_id])).rows[0];
    assert.equal(row.scan_status, verdict instanceof Error ? 'failed' : verdict);
    if (verdict === 'clean') {
      const download = await rpc(db, 'customer', 'download', payload);
      assert.deepEqual(Buffer.from(await (await storage.get('support-clean', download.clean_path)).arrayBuffer()), pdf);
    } else await assert.rejects(rpc(db, 'customer', 'download', payload), { code: '55000' });
    await rpc(db, 'customer', 'delete', payload);
    await assert.rejects(rpc(db, 'customer', 'download', payload), { code: 'P0002' });
  }
});
test('forged and duplicate scanner results are rejected', async () => {
  const storage = new MockStorage(); const { request } = await create(db); const payload = await uploaded(db, request.id, storage);
  const job = await workerRpc(db, 'claim');
  assert.equal(job.id, payload.attachment_id);
  await assert.rejects(workerRpc(db, 'finish', { attachment_id: job.id, lease: randomUUID(), sha256: job.sha256, status: 'clean' }), { code: '40001' });
  await assert.rejects(workerRpc(db, 'finish', { attachment_id: job.id, lease: job.scan_lease, sha256: sha('forged'), status: 'clean' }), { code: '22023' });
  const result = { attachment_id: job.id, lease: job.scan_lease, sha256: job.sha256, status: 'failed' };
  await workerRpc(db, 'finish', result);
  await assert.rejects(workerRpc(db, 'finish', result), { code: '40001' });
});
test('part integrity failure never promotes a file', async () => {
  const storage = new MockStorage(); const { request } = await create(db); const payload = await uploaded(db, request.id, storage);
  for (const key of storage.objects.keys()) storage.objects.set(key, Buffer.from('tampered'));
  await scanNext({ storage, scanner: { configured: true, scan() { assert.fail('Cannot scan corrupted upload'); } }, rpc: (op, value) => workerRpc(db, op, value) });
  assert.equal((await rpc(db, 'customer', 'list', payload)).attachments[0].scan_status, 'failed');
});
test('all attachment tables force RLS and untrusted roles cannot invoke scanner or metadata RPCs', async () => {
  for (const role of ['anon','authenticated']) {
    for (const statement of ["SELECT public.support_attachment_rpc('internal','list','{}')", "SELECT public.support_attachment_worker_rpc('claim','{}')", "SELECT public.support_attachment_create_rpc('{}',gen_random_uuid())", 'SELECT * FROM support.support_attachments']) await assert.rejects(db.transaction(async tx => { await tx.exec(`SET LOCAL ROLE ${role}`); await tx.query(statement); }), { code: '42501' });
  }
  const rows = (await db.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE relname IN ('support_attachments','support_attachment_parts','support_attachment_audit','support_attachment_objects','support_request_upload_keys')")).rows;
  assert.equal(rows.length, 5); assert.ok(rows.every(row => row.relrowsecurity && row.relforcerowsecurity));
});
test('signature, MIME, size, hash and Office disguise are validated before scanning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'attachment-validation-')); const path = join(dir, 'file');
  try {
    await writeFile(path, pdf); const data = metadata(randomUUID()); await validateFile(path, data);
    for (const patch of [{ mime: 'image/png' }, { original_name: 'test.png' }, { bytes: 1 }, { sha256: sha('wrong') }]) await assert.rejects(validateFile(path, { ...data, ...patch }));
    await writeFile(path, Buffer.from('PK\x03\x04not-a-real-office-archive'));
    await assert.rejects(validateFile(path, { original_name: 'fake.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', bytes: 29, sha256: sha('fake') }));
  } finally { await rm(dir, { recursive: true }); }
});
test('private Storage adapter rejects path manipulation, public buckets and redirects', async () => {
  const path = `${randomUUID()}/${randomUUID()}/${randomUUID()}`; assert.equal(checkedPath(path), path);
  for (const bad of ['../x', path + '/more', path.replace('/', '/%2e%2e/'), 'https://attacker.invalid']) assert.throws(() => checkedPath(bad));
  assert.throws(() => storageAdapter({ url: 'http://external.invalid', key: 'test' }), /TLS/);
  const calls = []; const storage = storageAdapter({ url: 'https://storage.invalid', key: 'test', fetcher: async (url, options) => { calls.push({url, options}); return new Response('{}'); } });
  await storage.put('support-quarantine', path, pdf, 'application/octet-stream', pdf.length);
  assert.equal(calls[0].options.redirect, 'error'); assert.equal(calls[0].options.headers['x-upsert'], 'false');
  await assert.rejects(storage.get('public', path), /bucket/);
});
test('Storage provisioning is private and blocks authenticated direct object access', async () => {
  const sql = await readFile(new URL('../../supabase/provisioning/support_attachment_storage.sql', import.meta.url), 'utf8');
  const local = await createDatabase();
  try {
    await local.exec('CREATE SCHEMA storage; CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]); CREATE TABLE storage.objects(bucket_id text); ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;');
    await local.exec(sql);
    assert.equal((await local.query('SELECT count(*)::integer AS n FROM storage.buckets WHERE public=false')).rows[0].n, 2);
    await local.exec("INSERT INTO storage.objects VALUES ('support-clean'),('support-quarantine'),('other'); GRANT USAGE ON SCHEMA storage TO authenticated; GRANT SELECT ON storage.objects TO authenticated; CREATE POLICY accidental_allow ON storage.objects TO authenticated USING(true);");
    const rows = await local.transaction(async tx => { await tx.exec('SET LOCAL ROLE authenticated'); return tx.query('SELECT * FROM storage.objects'); });
    assert.deepEqual(rows.rows, [{ bucket_id: 'other' }]);
  } finally { await local.close(); }
});

test('retention expires abandoned reservations and retries failed object removal without losing records', async () => {
  const { request } = await create(db); const payload = metadata(request.id);
  const reservation = await rpc(db,'customer','prepare',payload); payload.attachment_id=reservation.id;
  const part = await rpc(db,'customer','part',{...payload,part:0,bytes:pdf.length,sha256:sha(pdf)});
  await db.query("UPDATE support.support_attachments SET expires_at=now()-interval '2 days' WHERE id=$1",[reservation.id]);
  await db.query("UPDATE support.support_attachment_objects SET created_at=now()-interval '8 days' WHERE attachment_id=$1",[reservation.id]);
  const worker = (operation, data) => workerRpc(db,operation,data);
  await assert.rejects(cleanupAttachments({rpc:worker,storage:{remove(){throw new Error('offline');}}}),/offline/);
  assert.equal((await rpc(db,'customer','list',payload)).attachments.length,0);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM support.support_attachment_objects WHERE attachment_id=$1',[reservation.id])).rows[0].n,1);
  const removed=[];
  await cleanupAttachments({rpc:worker,storage:{async remove(bucket,path){removed.push({bucket,path});}}});
  assert.deepEqual(removed,[{bucket:'support-quarantine',path:part.object_path}]);
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM support.support_attachment_objects WHERE attachment_id=$1',[reservation.id])).rows[0].n,0);
});

test('maximum 10 MiB file uploads in ten chunks and promotes without losing bytes',async()=>{
  const storage=new MockStorage();const {request}=await create(db);const data=Buffer.alloc(10485760,32);pdf.copy(data);
  const payload=await uploaded(db,request.id,storage,data);
  assert.equal(storage.objects.size,10);
  await scanNext({storage,scanner:mockScanner('clean'),rpc:(op,value)=>workerRpc(db,op,value)});
  const item=await rpc(db,'customer','download',payload);
  assert.equal(sha(Buffer.from(await(await storage.get('support-clean',item.clean_path)).arrayBuffer())),sha(data));
});

test('retention keeps a live clean object and waits thirty days after soft deletion',async()=>{
  const storage=new MockStorage();const {request}=await create(db);const payload=await uploaded(db,request.id,storage);
  await scanNext({storage,scanner:mockScanner('clean'),rpc:(op,value)=>workerRpc(db,op,value)});
  await db.query("UPDATE support.support_attachment_objects SET created_at=now()-interval '60 days' WHERE attachment_id=$1",[payload.attachment_id]);
  let candidates=await workerRpc(db,'gc');assert.equal(candidates.some(item=>item.attachment_id===payload.attachment_id&&item.bucket==='support-clean'),false);
  await rpc(db,'customer','delete',payload);
  candidates=await workerRpc(db,'gc');assert.equal(candidates.some(item=>item.attachment_id===payload.attachment_id&&item.bucket==='support-clean'),false);
  await db.query("UPDATE support.support_attachments SET deleted_at=now()-interval '31 days' WHERE id=$1",[payload.attachment_id]);
  candidates=await workerRpc(db,'gc');assert.equal(candidates.some(item=>item.attachment_id===payload.attachment_id&&item.bucket==='support-clean'),true);
});
