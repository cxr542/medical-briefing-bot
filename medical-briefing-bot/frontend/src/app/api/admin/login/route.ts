import {
  ADMIN_AUTH_FAILURE_REASON,
  createAdminSessionToken,
  hasSameOrigin,
  inspectAdminCredential,
  logPreviewAdminAuthDiagnostic,
  serializeAdminSessionCookie,
} from '@/lib/adminAuth.mjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status: number, cookie?: string) => Response.json(body, {
  status,
  headers: {
    'Cache-Control': 'no-store, max-age=0',
    ...(cookie ? { 'Set-Cookie': cookie } : {}),
  },
});

const readJsonBodyLimited = async (request: Request): Promise<unknown | null> => {
  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > 4096) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
};

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return json({ error: '인증할 수 없습니다.' }, 403);
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') {
    return json({ error: '인증할 수 없습니다.' }, 400);
  }

  const contentLengthHeader = request.headers.get('content-length');
  if (contentLengthHeader && (!/^\d+$/.test(contentLengthHeader) || Number(contentLengthHeader) > 4096)) {
    return json({ error: '인증 정보를 확인해주세요.' }, 400);
  }
  const body = await readJsonBodyLimited(request);
  if (body === null) return json({ error: '인증 정보를 확인해주세요.' }, 400);

  const password = body && typeof body === 'object' && 'password' in body
    ? body.password
    : null;
  const diagnostic = inspectAdminCredential(password);
  if (diagnostic.failureReason !== null) {
    logPreviewAdminAuthDiagnostic(diagnostic);
    return json({ error: '인증 정보가 올바르지 않습니다.' }, 401);
  }

  let token: string | null;
  try {
    token = createAdminSessionToken();
  } catch {
    logPreviewAdminAuthDiagnostic({
      ...diagnostic,
      failureReason: ADMIN_AUTH_FAILURE_REASON.SESSION_CREATION_FAILED,
    });
    return json({ error: '인증할 수 없습니다.' }, 503);
  }
  if (!token) {
    logPreviewAdminAuthDiagnostic({
      ...diagnostic,
      failureReason: ADMIN_AUTH_FAILURE_REASON.SESSION_CREATION_FAILED,
    });
    return json({ error: '인증할 수 없습니다.' }, 503);
  }

  let cookie: string;
  try {
    cookie = serializeAdminSessionCookie(token);
  } catch {
    logPreviewAdminAuthDiagnostic({
      ...diagnostic,
      failureReason: ADMIN_AUTH_FAILURE_REASON.SESSION_CREATION_FAILED,
    });
    return json({ error: '인증할 수 없습니다.' }, 503);
  }

  return json({ ok: true }, 200, cookie);
}
