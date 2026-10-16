import { supportApi } from '@/lib/support/server';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const GET = (request: Request) => supportApi(request, 'customer', 'list');
export const POST = (request: Request) => supportApi(request, 'customer', 'create');
