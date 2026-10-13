import 'server-only';
import { isIP } from 'node:net';
import { createAdminSupabaseClient } from '@/lib/adminSupabase';
import { hasSameOrigin } from '@/lib/adminAuth.mjs';
import { CustomerAuthService, rateKeys, readSessionCookie, sessionCookie, type PrincipalKind } from './core.mjs';

const noStore = { 'Cache-Control': 'no-store, max-age=0' };
const json = (body: unknown, status: number, cookie?: string) => Response.json(body, {
  status, headers: { ...noStore, ...(cookie ? { 'Set-Cookie': cookie } : {}), ...(status === 429 ? { 'Retry-After': '900' } : {}) },
});

export function createCustomerAuthService() {
  if (process.env.CUSTOMER_AUTH_FOUNDATION_ENABLED !== 'true') throw new Error('Customer auth is disabled');
  const client = createAdminSupabaseClient();
  return new CustomerAuthService({
    async call(operation, payload) {
      const { data, error } = await client.rpc('customer_auth_rpc', { operation, payload });
      if (error) throw new Error('Customer authentication store unavailable');
      return data;
    },
  });
}

export async function readBody(request: Request, limit = 4096): Promise<Record<string, unknown> | null> {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

export async function customerLogin(request: Request, kind: PrincipalKind) {
  if (!hasSameOrigin(request)) return json({ error: '요청을 처리할 수 없습니다.' }, 403);
  const body = await readBody(request);
  if (!body) return json({ error: '인증 정보를 확인해 주세요.' }, 400);
  try {
    const service = createCustomerAuthService();
    const identifier = typeof body.identifier === 'string' ? body.identifier.trim() : '';
    // Vercel's platform-set IP header only; arbitrary X-Forwarded-For is not trusted.
    const source = request.headers.get('x-vercel-forwarded-for') || '';
    const ip = isIP(source) ? source : 'unknown';
    const keys = rateKeys(kind, identifier.slice(0, 64), ip, process.env.CUSTOMER_AUTH_RATE_LIMIT_SECRET || '');
    const result = await service.login(kind, identifier, body.password, keys);
    if (result.status !== 200 || !result.token) return json({ error: result.error }, result.status);
    return json({ ok: true, principal: result.principal }, 200, sessionCookie(kind, result.token));
  } catch { return json({ error: '인증 서비스를 사용할 수 없습니다.' }, 503); }
}

export async function customerSession(request: Request, kind: PrincipalKind) {
  const token = readSessionCookie(request, kind);
  if (!token) return json({ error: '인증이 필요합니다.' }, readSessionCookie(request, kind === 'user' ? 'admin' : 'user') ? 403 : 401);
  try {
    const principal = await createCustomerAuthService().authorize(kind, token);
    return principal ? json({ principal }, 200) : json({ error: '인증이 필요합니다.' }, 401, sessionCookie(kind, '', undefined, true));
  } catch { return json({ error: '인증 서비스를 사용할 수 없습니다.' }, 503); }
}

export async function customerLogout(request: Request, kind: PrincipalKind) {
  if (!hasSameOrigin(request)) return json({ error: '요청을 처리할 수 없습니다.' }, 403);
  try {
    const token = readSessionCookie(request, kind);
    if (token) await createCustomerAuthService().logout(kind, token);
    return json({ ok: true }, 200, sessionCookie(kind, '', undefined, true));
  } catch { return json({ error: '인증 서비스를 사용할 수 없습니다.' }, 503); }
}
