import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { customerPayload } from './supportDatabase.mjs';
export const attachmentMigration = await readFile(new URL('../../../supabase/migrations/20261016035115_support_attachments.sql', import.meta.url), 'utf8');
export const conflictMigration = await readFile(new URL('../../../supabase/migrations/20261019041429_support_conflict_sqlstate.sql', import.meta.url), 'utf8');
export const sha = data => createHash('sha256').update(data).digest('hex');
export const pdf = Buffer.from('%PDF-1.7\nTest document\n%%EOF\n');
export function metadata(request_id, data = pdf) { return customerPayload({ request_id, client_key: randomUUID(), original_name: 'test.pdf', mime: 'application/pdf', bytes: data.length, sha256: sha(data), token_hash: sha('token') }); }
export async function attachmentRpc(db, audience, operation, payload) {
  return db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE service_role');
    return (await tx.query('SELECT public.support_attachment_rpc($1,$2,$3::jsonb) AS data', [audience, operation, JSON.stringify(payload)])).rows[0].data;
  });
}
export async function workerRpc(db, operation, payload = {}) {
  return db.transaction(async tx => {
    await tx.exec('SET LOCAL ROLE service_role');
    return (await tx.query('SELECT public.support_attachment_worker_rpc($1,$2::jsonb) AS data', [operation, JSON.stringify(payload)])).rows[0].data;
  });
}
export class MockStorage {
  objects = new Map();
  async put(bucket, path, body) {
    const key = `${bucket}/${path}`;
    if (this.objects.has(key)) throw new Error('Object exists');
    const chunks = [];
    if (body instanceof Uint8Array) chunks.push(body);
    else for await (const chunk of body) chunks.push(chunk);
    this.objects.set(key, Buffer.concat(chunks));
  }
  async get(bucket, path) {
    const data = this.objects.get(`${bucket}/${path}`);
    if (!data) throw new Error('Missing object');
    return new Response(data);
  }
}
export const mockScanner = verdict => ({ configured: true, async scan() { if (verdict instanceof Error) throw verdict; return verdict; } });
export async function uploaded(db, requestId, storage, data = pdf) {
  const payload = metadata(requestId, data);
  const reserved = await attachmentRpc(db, 'customer', 'prepare', payload);
  Object.assign(payload, { attachment_id: reserved.id });
  for (let offset = 0, index = 0; offset < data.length; offset += 1048576, index++) {
    const body = data.subarray(offset, offset + 1048576);
    const part = await attachmentRpc(db, 'customer', 'part', { ...payload, part: index, bytes: body.length, sha256: sha(body) });
    await storage.put('support-quarantine', part.object_path, body);
    await attachmentRpc(db, 'customer', 'part_done', { ...payload, part: index, lease: part.lease });
  }
  await attachmentRpc(db, 'customer', 'complete', payload);
  return payload;
}
