import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { isAdminRequestAuthorized } from '@/lib/adminAuth.mjs';
import { SupportCenter } from '@/components/support/SupportCenter';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '기술지원 관리 | Medical Briefing', robots: { index: false, follow: false } };
export default async function InternalSupportPage() {
  const request = new Request('https://admin.invalid', { headers: await headers() });
  if (!isAdminRequestAuthorized(request)) redirect('/admin');
  return <SupportCenter audience="internal" enabled={process.env.SUPPORT_ENABLED === 'true'} attachmentsEnabled={process.env.SUPPORT_ATTACHMENTS_ENABLED === 'true'}/>;
}
