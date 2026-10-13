import type { Metadata } from 'next';
import CustomerAdmin from '@/components/customer-admin/CustomerAdmin';

export const metadata: Metadata = {
  title: '고객 계정 관리 | Medical Briefing',
  robots: { index: false, follow: false },
};

export default function CustomerAdminPage() {
  return <CustomerAdmin />;
}
