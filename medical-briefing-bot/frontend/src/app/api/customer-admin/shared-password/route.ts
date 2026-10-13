import { managementApi } from '@/lib/customer-auth/managementServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) { return managementApi(request, 'password'); }
