import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSessionCookie } from '@/lib/customer-auth/core.mjs';
import { createCustomerAuthService } from '@/lib/customer-auth/server';
import { CustomerUsage } from '@/components/customer-admin/CustomerUsage';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'ID별 사용량 | Medical Briefing', robots: { index: false, follow: false } };
export default async function CustomerUsagePage() {
  const request = new Request('https://customer-admin.invalid', { headers: await headers() });
  const token = readSessionCookie(request, 'admin');
  if (!token) redirect('/customer-admin/login');
  let authorized = false;
  try { authorized = Boolean(await createCustomerAuthService().authorize('admin', token)); }
  catch (error) { if (!(error instanceof Error)) throw error; }
  if (!authorized) redirect('/customer-admin/login');
  return <CustomerUsage />;
}
