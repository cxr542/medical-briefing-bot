import { supportApi } from '@/lib/support/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return supportApi(request, 'internal', 'status', (await context.params).id);
}
