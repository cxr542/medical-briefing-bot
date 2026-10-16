import { supportApi } from '@/lib/support/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => supportApi(request, 'internal', 'list');
