import Link from 'next/link';

export function CustomerAdminNav({ support = false }: { readonly support?: boolean }) {
  return <nav aria-label="고객 관리센터 메뉴" className="mb-7 flex flex-wrap gap-2">
    <Link href="/customer-admin" aria-current={!support ? 'page' : undefined} className={!support ? 'ca-primary' : 'ca-secondary'}>계정 관리</Link>
    <Link href="/customer-admin/support" aria-current={support ? 'page' : undefined} className={support ? 'ca-primary' : 'ca-secondary'}>기술지원 요청</Link>
  </nav>;
}
