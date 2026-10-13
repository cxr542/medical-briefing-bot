import 'server-only';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { createCustomerAuthService } from './server';
import { readSessionCookie } from './core.mjs';

// Explicit, temporary rollout/rollback switch. Missing configuration fails closed.
export const protectionEnabled = () => process.env.CUSTOMER_AUTH_ENFORCEMENT_ENABLED !== 'false';
export async function authorizeUser(request: Request) {
  if (!protectionEnabled()) return null;
  const token = readSessionCookie(request, 'user');
  if (!token) return Response.json({error:'인증이 필요합니다.'}, {status:401,headers:{'Cache-Control':'no-store'}});
  try {
    if (await createCustomerAuthService().authorize('user', token)) return null;
    return Response.json({error:'인증이 필요합니다.'}, {status:401,headers:{'Cache-Control':'no-store'}});
  } catch {
    return Response.json({error:'인증 서비스를 사용할 수 없습니다.'}, {status:503,headers:{'Cache-Control':'no-store'}});
  }
}
export async function requireUser(path: '/' | '/neurology-dashboard') {
  const result = await authorizeUser(new Request('http://application.local', {headers:await headers()}));
  if (result) redirect(`/login?next=${encodeURIComponent(path)}`);
}
