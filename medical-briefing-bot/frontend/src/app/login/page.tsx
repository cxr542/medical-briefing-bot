import CustomerLogin from '@/components/CustomerLogin';
import { safeUserNext } from '@/lib/customerReturn';
export const metadata={title:'로그인 | Medical Briefing',robots:{index:false,follow:false}};
export const dynamic='force-dynamic';
export default async function Login({searchParams}:{searchParams:Promise<{next?:string}>}) {
  return <CustomerLogin next={safeUserNext((await searchParams).next)}/>;
}
