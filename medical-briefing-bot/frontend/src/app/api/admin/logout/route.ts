import {
  hasSameOrigin,
  serializeClearedAdminSessionCookie,
} from '@/lib/adminAuth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) {
    return Response.json({ error: '요청을 처리할 수 없습니다.' }, {
      status: 403,
      headers: { 'Cache-Control': 'no-store, max-age=0' },
    });
  }

  return Response.json({ ok: true }, {
    status: 200,
    headers: {
      'Cache-Control': 'no-store, max-age=0',
      'Set-Cookie': serializeClearedAdminSessionCookie(),
    },
  });
}
