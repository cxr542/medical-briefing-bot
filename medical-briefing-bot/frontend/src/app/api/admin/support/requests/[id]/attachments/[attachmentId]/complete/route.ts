import { attachmentApi } from '@/lib/support/attachments/api';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
type Context = { params: Promise<{ id: string; attachmentId?: string; part?: string }> };
export async function POST(request: Request, context: Context) {
  const { id, attachmentId, part } = await context.params;
  return attachmentApi(request, 'internal', 'complete', id, attachmentId, part);
}
