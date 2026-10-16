import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { readSessionCookie } from '@/lib/customer-auth/core.mjs';
import { createCustomerAuthService } from '@/lib/customer-auth/server';
import { SupportCenter } from '@/components/support/SupportCenter';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '기술지원 요청 | Medical Briefing', robots: { index: false, follow: false } };
export default async function CustomerSupportPage() {
  const request = new Request('https://customer-admin.invalid', { headers: await headers() });
  const token = readSessionCookie(request, 'admin');
  if (!token) redirect('/customer-admin/login');
  let authorized = false;
  try { authorized = Boolean(await createCustomerAuthService().authorize('admin', token)); }
  catch (error) { if (!(error instanceof Error)) throw error; }
  if (!authorized) redirect('/customer-admin/login');
  return <SupportCenter audience="customer" enabled={process.env.SUPPORT_ENABLED === 'true'}/>;
}
