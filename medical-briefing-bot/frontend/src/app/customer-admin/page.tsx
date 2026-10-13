import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import CustomerAdmin from '@/components/customer-admin/CustomerAdmin';
import { readSessionCookie } from '@/lib/customer-auth/core.mjs';
import { createCustomerAuthService } from '@/lib/customer-auth/server';
export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title:'고객 계정 관리 | Medical Briefing',robots:{index:false,follow:false} };
export default async function CustomerAdminPage() {
  const request=new Request('https://customer-admin.invalid',{headers:await headers()});
  const token=readSessionCookie(request,'admin');
  let authorized=false;
  try{authorized=Boolean(token&&await createCustomerAuthService().authorize('admin',token));}catch{}
  if(!authorized)redirect('/customer-admin/login');
  return <CustomerAdmin />;
}
