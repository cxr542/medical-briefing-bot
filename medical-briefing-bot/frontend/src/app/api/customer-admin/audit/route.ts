import { managementApi } from '@/lib/customer-auth/managementServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) { return managementApi(request, 'audit'); }
