'use client';
import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, LifeBuoy, Plus, RefreshCw } from 'lucide-react';
import { CustomerAdminNav } from '@/components/customer-admin/CustomerAdminNav';
import { statuses, type Audience } from '@/lib/support/contract';
import { formatSupportDate, loadList, priorityLabels, statusLabels, type SupportItem } from '@/lib/support/client';
import { Pagination, StatusBadge, SupportFailure } from './SupportPrimitives';
import { NewRequestDialog } from './NewRequestDialog';
import { SupportRequestDetail } from './SupportRequestDetail';
import '../customer-admin/customer-admin.css';
import './support.css';

export function SupportCenter({ audience, enabled }: { readonly audience: Audience; readonly enabled: boolean }) {
  const customer = audience === 'customer';
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [list, setList] = useState<{ readonly requests: readonly SupportItem[]; readonly total: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const lastSelected = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || selected) return;
    const controller = new AbortController();
    void loadList(audience, `page=${page}&page_size=10${filter ? `&status=${filter}` : ''}`, controller.signal)
      .then(data => { if (!controller.signal.aborted) { setList(data); setError(null); } })
      .catch(error => { if (!controller.signal.aborted) { setList(null); setError(error instanceof Error ? error : new Error('목록을 불러올 수 없습니다.')); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [audience, enabled, filter, page, revision, selected]);
  useEffect(() => {
    if (!selected && !loading && lastSelected.current) {
      document.getElementById(`support-row-${lastSelected.current}`)?.focus();
      lastSelected.current = null;
    }
  }, [selected, loading]);
  function reload() { setLoading(true); setList(null); setRevision(value => value + 1); }
  return <div className={`customer-admin support-center ${customer ? 'support-customer' : 'support-internal'}`}>
    <header className="support-header"><div className="support-container flex flex-wrap items-center justify-between gap-4 py-5">
      <Link className="flex items-center gap-3 font-bold" href={customer ? '/customer-admin' : '/admin'}><span className="support-logo"><LifeBuoy size={24} aria-hidden="true"/></span><span>Medical Briefing<span className="mt-1 block text-xs font-normal text-slate-500">{customer ? '고객 관리센터' : '내부 운영센터'}</span></span></Link>
      <Link className="support-button support-secondary" href={customer ? '/customer-admin' : '/admin'}>{customer ? '계정 관리로' : '관리자 홈으로'}<ArrowUpRight size={16} aria-hidden="true"/></Link>
    </div></header>
    <main className="support-container py-8 sm:py-10">
      {customer ? <CustomerAdminNav support/> : <nav aria-label="관리자 메뉴" className="mb-7 flex flex-wrap gap-2"><Link className="support-button support-secondary" href="/admin">운영 대시보드</Link><Link className="support-button support-primary" href="/admin/support" aria-current="page">기술지원 관리</Link></nav>}
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4"><div><p className="support-eyebrow">{customer ? 'CUSTOMER SUPPORT' : 'SUPPORT MANAGEMENT'}</p><h1 className="mt-2 text-2xl font-bold sm:text-3xl">{customer ? '기술지원 요청' : '기술지원 관리'}</h1><p className="mt-3 text-sm leading-6 text-slate-500">{customer ? '서비스 이용 중 궁금한 점을 남기고 처리 현황을 확인하세요.' : '고객 요청을 확인하고 답변과 처리 과정을 관리하세요.'}</p></div>
        {enabled && !selected && customer && <button className="support-button support-primary" onClick={() => setCreating(true)}><Plus size={18} aria-hidden="true"/>새 요청 등록</button>}
      </div>
      <div role="status" aria-live="polite" aria-atomic="true">{notice && <p className="support-notice mb-5">{notice}</p>}</div>
      {!enabled ? <section className="support-card support-empty"><LifeBuoy size={32} aria-hidden="true"/><h2>기술지원 기능 준비 중</h2><p>기술지원 기능이 아직 활성화되지 않았습니다.</p><p>{customer ? '기존 계정 관리 기능은 계속 이용할 수 있습니다.' : '서비스 준비가 완료되면 요청을 관리할 수 있습니다.'}</p></section>
        : selected ? <SupportRequestDetail key={selected} id={selected} audience={audience} onBack={() => { lastSelected.current = selected; setSelected(null); setNotice(''); reload(); }}/>
        : <section className="support-card" aria-label="지원 요청 목록" aria-busy={loading}>
          <div className="mb-5 flex flex-wrap items-end justify-between gap-4"><div><label className="ca-label" htmlFor="support-filter">처리 상태</label><select id="support-filter" className="ca-input min-w-40" value={filter} disabled={loading} onChange={event => { setFilter(event.target.value); setPage(1); setLoading(true); setList(null); }}><option value="">전체 상태</option>{statuses.map(status => <option value={status} key={status}>{statusLabels[status]}</option>)}</select></div><button className="support-button support-secondary" onClick={reload} disabled={loading}><RefreshCw size={16} aria-hidden="true"/>새로고침</button></div>
          {loading ? <p className="support-empty" role="status">요청 목록을 불러오는 중…</p> : error ? <SupportFailure error={error} audience={audience} retry={reload}/> : !list?.requests.length ? <div className="support-empty"><h2>등록된 요청이 없습니다</h2><p>{filter ? '다른 상태를 선택해 주세요.' : customer ? '새 요청을 등록하면 이곳에서 처리 현황을 확인할 수 있습니다.' : '고객이 등록한 기술지원 요청이 이곳에 표시됩니다.'}</p></div> : <ul className="support-list">{list.requests.map(request => <li key={request.id}><div className="min-w-0"><div className="mb-2 flex flex-wrap items-center gap-2"><span className="support-number">#{request.request_number}</span><StatusBadge status={request.status}/><span className="support-priority">우선순위 {priorityLabels[request.priority]}</span></div><button id={`support-row-${request.id}`} className="support-title" onClick={() => { setSelected(request.id); setNotice(''); }}>{request.title}<span className="sr-only"> 상세 보기</span></button><p className="mt-2 text-xs leading-6 text-slate-500">접수 {formatSupportDate(request.created_at)}{!customer && <span className="block sm:ml-4 sm:inline">최근 수정 {formatSupportDate(request.updated_at)}</span>}</p></div><button className="support-button support-secondary shrink-0" onClick={() => setSelected(request.id)} aria-label={`요청 #${request.request_number} 상세 보기`}>상세 보기<ArrowUpRight size={16} aria-hidden="true"/></button></li>)}</ul>}
          {list && <Pagination page={page} total={list.total} busy={loading} onPage={value => { setPage(value); setLoading(true); setList(null); }}/ >}
        </section>}
    </main>
    {creating && <NewRequestDialog onClose={() => setCreating(false)} onCreated={id => { setCreating(false); setSelected(id); setNotice('기술지원 요청을 등록했습니다.'); }}/ >}
  </div>;
}
