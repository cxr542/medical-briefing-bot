import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hasSameOrigin } from '@/lib/adminAuth.mjs';
import { createAdminSupabaseClient } from '@/lib/adminSupabase';
import { readBody } from '@/lib/customer-auth/server';
import { supportCredentials } from '@/lib/support/server';
import { databaseError, requestId, SupportError, type Audience } from '@/lib/support/contract';
import { attachmentList, PART_BYTES, prepareAttachment } from './contract';
import { storageAdapter } from './storage.mjs';

const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const safeHeaders = { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff', 'Cross-Origin-Resource-Policy': 'same-origin' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: safeHeaders });
const partResult = z.union([z.object({ ready: z.literal(true) }), z.object({ object_path: z.string(), lease: z.uuid(), ready: z.boolean() })]);
const downloadResult = z.object({ clean_path: z.string(), mime: z.string(), original_name: z.string(), bytes: z.number().int().positive() });
const preparedResult = z.object({ id: z.uuid(), expires_at: z.string(), uploaded: z.boolean() });
async function bytes(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new SupportError(400, 'EMPTY_PART');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > PART_BYTES) { await reader.cancel(); throw new SupportError(413, 'PART_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return result;
}

export async function attachmentApi(request: Request, audience: Audience, operation: 'list' | 'prepare' | 'part' | 'complete' | 'download' | 'delete', rid: string, aid?: string, index?: string) {
  try {
    const auth = await supportCredentials(request, audience);
    if (process.env.SUPPORT_ENABLED !== 'true' || process.env.SUPPORT_ATTACHMENTS_ENABLED !== 'true') return json({ error: 'SUPPORT_DISABLED' }, 503);
    if (!['list', 'download'].includes(operation) && !hasSameOrigin(request)) throw new SupportError(403, 'INVALID_ORIGIN');
    const payload: Record<string, unknown> = { request_id: requestId.parse(rid), ...auth };
    if (aid !== undefined) payload.attachment_id = z.uuid().parse(aid);
    const client = createAdminSupabaseClient();
    async function rpc(op: string, extra: Record<string, unknown> = {}) {
      const { data, error } = await client.rpc('support_attachment_rpc', { audience, operation: op, payload: { ...payload, ...extra } });
      if (error) {
        if (error.code === '55000') throw new SupportError(423, 'QUARANTINED');
        if (error.code === '42501' && ['part','complete'].includes(op)) throw new SupportError(403, 'UPLOAD_EXPIRED');
        throw databaseError(error.code);
      }
      return data;
    }
    if (operation === 'prepare') {
      Object.assign(payload, prepareAttachment.parse(await readBody(request, 4096)));
      const token = randomBytes(32).toString('base64url');
      const data = preparedResult.parse(await rpc('prepare', { token_hash: hash(token) }));
      return json({ ...data, token, part_bytes: PART_BYTES }, 201);
    }
    if (operation === 'list') return json(attachmentList.parse(await rpc('list')));
    if (operation === 'delete') return json(await rpc('delete'));
    if (operation === 'download') {
      const data = downloadResult.parse(await rpc('download'));
      const storage = storageAdapter({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
      const file = await storage.get('support-clean', data.clean_path);
      const preview = new URL(request.url).searchParams.get('preview') === '1' && ['image/jpeg', 'image/png', 'image/webp'].includes(data.mime);
      return new Response(file.body, { headers: { ...safeHeaders, 'Content-Type': data.mime, 'Content-Length': String(data.bytes),
        'Content-Disposition': `${preview ? 'inline' : 'attachment'}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(data.original_name).replace(/[!'()*]/g, character => `%${character.charCodeAt(0).toString(16)}`)}`,
        'Content-Security-Policy': "sandbox; default-src 'none'", 'Referrer-Policy': 'no-referrer' } });
    }
    const token = z.string().regex(/^[a-zA-Z0-9_-]{43}$/).parse(request.headers.get('x-support-upload-token'));
    payload.token_hash = hash(token);
    if (operation === 'complete') return json(await rpc('complete'));
    payload.part = z.string().regex(/^[0-9]$/).transform(Number).parse(index);
    if (request.headers.get('content-type') !== 'application/octet-stream') throw new SupportError(400, 'INVALID_CONTENT_TYPE');
    // Authorize the request owner before consuming even a bounded chunk body.
    await rpc('list');
    const body = await bytes(request);
    const part = partResult.parse(await rpc('part', { bytes: body.length, sha256: hash(body) }));
    if ('object_path' in part) {
      const storage = storageAdapter({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY });
      try {
        await storage.put('support-quarantine', part.object_path, body, 'application/octet-stream', body.length);
        await rpc('part_done', { lease: part.lease });
      } catch (error) {
        await rpc('part_failed', { lease: part.lease });
        throw error;
      }
    }
    return json({ ok: true });
  } catch (error) {
    if (error instanceof SupportError) return json({ error: error.code }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'INVALID_INPUT' }, 400);
    return json({ error: 'SUPPORT_UNAVAILABLE' }, 503);
  }
}
