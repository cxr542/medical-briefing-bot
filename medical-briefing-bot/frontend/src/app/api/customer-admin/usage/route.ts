import { createCustomerAuthService } from '@/lib/customer-auth/server';
import { readSessionCookie, tokenHash } from '@/lib/customer-auth/core.mjs';
import { getAdminSessionToken } from '@/lib/adminAuth.mjs';
import { createAdminSupabaseClient } from '@/lib/adminSupabase';
import { usageQuery, usageResult } from '@/lib/customer-usage/contract';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store, max-age=0' },
});
export async function GET(request: Request) {
  const token = readSessionCookie(request, 'admin');
  if (!token) return json({ error: '관리자 로그인이 필요합니다.' },
    readSessionCookie(request, 'user') || getAdminSessionToken(request.headers.get('cookie')) ? 403 : 401);
  try {
    if (!await createCustomerAuthService().authorize('admin', token)) return json({ error: '관리자 로그인이 필요합니다.' }, 401);
    const query = usageQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!query.success) return json({ error: '날짜와 조회 조건을 확인해 주세요. 최대 366일까지 조회할 수 있습니다.' }, 400);
    const { data, error } = await createAdminSupabaseClient().rpc('customer_usage_rpc', {
      operation: 'list', payload: { ...query.data, admin_token_hash: tokenHash(token) },
    });
    if (error?.code === '42501') return json({ error: '관리자 로그인이 필요합니다.' }, 401);
    if (error) return json({ error: '사용량을 불러올 수 없습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    const result = usageResult.safeParse(data);
    return result.success ? json(result.data) : json({ error: '사용량 응답을 확인할 수 없습니다.' }, 503);
  } catch (error) {
    // no-excuse-ok: catch — HTTP boundary hides store details and credentials.
    if (!(error instanceof Error)) throw error;
    return json({ error: '사용량 서비스를 사용할 수 없습니다.' }, 503);
  }
}
