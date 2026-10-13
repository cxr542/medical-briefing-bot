import CustomerAdminLogin from '@/components/customer-admin/CustomerAdminLogin';
import { safeAdminNext } from '@/lib/customerAdminApi';
export const metadata={title:'고객 관리자 로그인 | Medical Briefing',robots:{index:false,follow:false}};
export default async function LoginPage({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const params=await searchParams;
  return <CustomerAdminLogin next={safeAdminNext(params.next)} />;
}
