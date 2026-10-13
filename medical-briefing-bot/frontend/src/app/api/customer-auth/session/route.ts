import { customerSession } from '@/lib/customer-auth/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return customerSession(request, 'user');
}
