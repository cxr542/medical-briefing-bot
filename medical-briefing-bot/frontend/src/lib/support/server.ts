import 'server-only';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { getAdminSessionToken, hasSameOrigin, isAdminRequestAuthorized } from '@/lib/adminAuth.mjs';
import { createAdminSupabaseClient } from '@/lib/adminSupabase';
import { readSessionCookie, tokenHash } from '@/lib/customer-auth/core.mjs';
import { createCustomerAuthService, readBody } from '@/lib/customer-auth/server';
import {
  createRequest, customerCreated, customerDetail, customerList, databaseError, detailQuery, internalChanged,
  internalDetail, internalList, listQuery, message, requestId, statusChange, SupportError,
  type Audience, type Operation,
} from '@/lib/support/contract';

const json = (body: unknown, status = 200) => Response.json(body, {
  status, headers: { 'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' },
});

async function credentials(request: Request, audience: Audience): Promise<Record<string, string>> {
  switch (audience) {
    case 'customer': {
      const token = readSessionCookie(request, 'admin');
      if (!token) throw new SupportError(readSessionCookie(request, 'user') || getAdminSessionToken(request.headers.get('cookie')) ? 403 : 401, 'UNAUTHORIZED');
      const principal = await createCustomerAuthService().authorize('admin', token);
      if (!principal) throw new SupportError(401, 'UNAUTHORIZED');
      return { admin_token_hash: tokenHash(token) };
    }
    case 'internal': {
      if (!isAdminRequestAuthorized(request)) {
        throw new SupportError(readSessionCookie(request, 'admin') || readSessionCookie(request, 'user') ? 403 : 401, 'UNAUTHORIZED');
      }
      const token = getAdminSessionToken(request.headers.get('cookie'));
      if (!token) throw new SupportError(401, 'UNAUTHORIZED');
      // The existing shared internal login identifies a session, not an individual operator.
      return { actor_id: createHash('sha256').update(token).digest('hex') };
    }
  }
}

function dto(audience: Audience, operation: Operation, data: unknown): unknown {
  const schema = (() => {
    switch (operation) {
      case 'list': return audience === 'customer' ? customerList : internalList;
      case 'detail': return audience === 'customer' ? customerDetail : internalDetail;
      case 'create': return customerCreated;
      case 'status': case 'comment': case 'note': return internalChanged;
    }
  })();
  const result = schema.safeParse(data);
  if (!result.success) throw new SupportError(503, 'SUPPORT_UNAVAILABLE');
  return result.data;
}

export async function supportApi(request: Request, audience: Audience, operation: Operation, id?: string) {
  try {
    // Authenticate before feature detection: disabling support never creates an auth bypass.
    const auth = await credentials(request, audience);
    if (process.env.SUPPORT_ENABLED !== 'true') return json({ error: 'SUPPORT_DISABLED' }, 503);
    const mutation = operation !== 'list' && operation !== 'detail';
    if (mutation && !hasSameOrigin(request)) throw new SupportError(403, 'INVALID_ORIGIN');
    const payload: Record<string, unknown> = {};
    if (id !== undefined) payload.request_id = requestId.parse(id);
    switch (operation) {
      case 'list': case 'detail': {
        const params = new URL(request.url).searchParams;
        if ([...new Set(params.keys())].some(key => params.getAll(key).length !== 1)) throw new SupportError(400, 'INVALID_INPUT');
        Object.assign(payload, (operation === 'list' ? listQuery : detailQuery).parse(Object.fromEntries(params)));
        break;
      }
      case 'create': Object.assign(payload, createRequest.parse(await readBody(request, 49152))); break;
      case 'status': Object.assign(payload, statusChange.parse(await readBody(request, 16384))); break;
      case 'comment': case 'note': Object.assign(payload, message.parse(await readBody(request, 49152))); break;
    }
    const client = createAdminSupabaseClient();
    const { data, error } = await client.rpc(audience === 'customer' ? 'customer_support_rpc' : 'admin_support_rpc', {
      operation, payload: { ...payload, ...auth },
    });
    if (error) throw databaseError(error.code);
    return json(dto(audience, operation, data), operation === 'create' || operation === 'comment' || operation === 'note' ? 201 : 200);
  } catch (error) {
    if (error instanceof SupportError) return json({ error: error.code }, error.status);
    if (error instanceof z.ZodError) return json({ error: 'INVALID_INPUT' }, 400);
    // HTTP boundary: configuration, database and unexpected errors are deliberately not reflected.
    return json({ error: 'SUPPORT_UNAVAILABLE' }, 503);
  }
}
