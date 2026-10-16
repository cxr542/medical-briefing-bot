import { supportApi } from '@/lib/support/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return supportApi(request, 'internal', 'detail', (await context.params).id);
}
