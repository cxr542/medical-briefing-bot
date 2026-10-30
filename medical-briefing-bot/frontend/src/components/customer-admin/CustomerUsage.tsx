'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { adminRequest, AdminApiError, formatAdminDate } from '@/lib/customerAdminApi';
import { usageResult } from '@/lib/customer-usage/contract';
import type { UsageResult } from '@/lib/customer-usage/contract';
import { CustomerAdminNav } from './CustomerAdminNav';
import './customer-admin.css';

const koreanDay = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const today = () => koreanDay(new Date());
const monthStart = () => `${today().slice(0, 7)}-01`;
const time = (value: string | null) => value ? formatAdminDate(value, true) : '기록 없음';
export function CustomerUsage() {
  const router = useRouter();
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(today);
  const [group, setGroup] = useState('day');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState(() => new URLSearchParams({ from: monthStart(), to: today(), group: 'day', search: '', page: '1' }).toString());
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<UsageResult | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true); setError(''); setData(null);
      try {
        const result = usageResult.parse(await adminRequest<unknown>(`usage?${query}`, { signal: controller.signal }));
        if (!controller.signal.aborted) setData(result);
      } catch (failure) {
        if (controller.signal.aborted) return;
        if (failure instanceof AdminApiError && (failure.status === 401 || failure.status === 403)) router.replace('/customer-admin/login');
        setError(failure instanceof Error ? failure.message : '사용량을 불러올 수 없습니다.');
      } finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [query, revision, router]);
  const move = (page: number) => {
    const params = new URLSearchParams(query); params.set('page', String(page)); setQuery(params.toString());
  };
  return <div className="customer-admin min-h-dvh bg-slate-50 text-slate-800">
    <header className="border-b border-slate-200 bg-white px-4 py-5 sm:px-8"><div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3"><p className="text-lg font-bold">Medical Briefing 고객 관리센터</p><Link href="/customer-admin" className="ca-secondary">계정 관리로</Link></div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <CustomerAdminNav usage />
      <h1 className="text-2xl font-bold sm:text-3xl">ID별 사용량</h1>
      <p className="mt-3 break-keep text-sm leading-6 text-slate-600">등록된 ID의 서비스 이용 현황입니다. 동일 ID를 함께 사용하면 합산됩니다.</p>
      <form className="ca-card mt-6" onSubmit={event => {
        event.preventDefault();
        setQuery(new URLSearchParams({ from, to, group, search, page: '1' }).toString()); setRevision(value => value + 1);
      }}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <label><span className="ca-label">시작일 (KST)</span><input className="ca-input" type="date" required value={from} max={to} onChange={event => setFrom(event.target.value)} /></label>
          <label><span className="ca-label">종료일 (KST)</span><input className="ca-input" type="date" required value={to} min={from} onChange={event => setTo(event.target.value)} /></label>
          <label><span className="ca-label">상세 집계 단위</span><select className="ca-input focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:outline-offset-2" value={group} onChange={event => setGroup(event.target.value)}><option value="day">일별</option><option value="week">주별 (월요일 시작)</option><option value="month">월별</option></select></label>
          <label><span className="ca-label">등록 ID 검색</span><input className="ca-input" type="search" maxLength={64} placeholder="ID 일부 입력" value={search} onChange={event => setSearch(event.target.value)} /></label>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-5 text-slate-600">최대 366일 · 기간 양 끝 날짜 포함</p><button className="ca-primary usage-query" disabled={loading}>조회</button></div>
      </form>
      <div className="mt-6" role="status" aria-live="polite">{loading ? '사용량을 불러오는 중…' : data ? `${data.total}개 ID · ${data.page}페이지` : ''}</div>
      {error && <section className="ca-card mt-4"><p role="alert">{error}</p><button type="button" className="ca-secondary mt-3" onClick={() => setRevision(value => value + 1)}>다시 시도</button></section>}
      {data && <>
        <section className="my-4 break-keep rounded-xl bg-blue-50 p-4 text-sm leading-6 text-blue-800" aria-label="집계 기준">
          <p>집계 시작: {time(data.started_at)} KST. 이전 기간은 미집계입니다.</p>
          <p>조회 기간: {data.from} ~ {data.to}. 접속일수와 로그인 횟수는 선택 기간 합계이며, 최근 접속은 전체 집계 기간 기준입니다.</p>
          <p>로그인 유지 중의 화면 이용도 접속일수에 포함합니다. 최근 접속은 화면이 열린 동안 약 1분 간격으로 확인하며, 실제 열람 시간이나 사람 수를 의미하지 않습니다.</p>
        </section>
        {data.users.length === 0 ? <p className="ca-card">조건에 맞는 등록 ID가 없습니다.</p> : <ul className="space-y-4" aria-label="ID별 사용량 목록">{data.users.map(user => <li className="ca-card min-w-0" key={user.id}>
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="min-w-0 break-all text-lg font-bold">{user.employee_number}</h2><span className="text-sm text-slate-600">{user.active ? '활성' : '비활성'}</span></div>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-slate-600">최근 접속 (KST)</dt><dd className="mt-1 font-medium">{time(user.last_seen_at)}</dd></div><div><dt className="text-slate-600">기간 내 접속일수</dt><dd className="mt-1 font-medium">{user.access_days}일</dd></div><div><dt className="text-slate-600">기간 내 로그인 횟수</dt><dd className="mt-1 font-medium">{user.login_count}회</dd></div></dl>
          <details className="mt-4"><summary className="flex min-h-11 cursor-pointer items-center rounded-lg text-sm font-semibold text-blue-700 focus-visible:outline-2 focus-visible:outline-blue-600">기간별 상세 보기</summary>
            {user.periods.length === 0 ? <p className="py-3 text-sm text-slate-600">선택 기간의 집계 기록이 없습니다.</p> : <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="py-3 text-left text-xs leading-5 text-slate-600">활동이 있는 기간만 표시합니다. 주·월 시작일이 조회 범위 밖이어도 합계에는 선택한 날짜만 포함합니다.</caption><thead className="bg-slate-50"><tr>{['기간 시작 (KST)', '접속일수', '로그인 횟수'].map(label => <th className="whitespace-nowrap p-3 font-medium" scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{user.periods.map(period => <tr className="border-b border-slate-100" key={period.period}><th className="whitespace-nowrap p-3 font-normal" scope="row">{period.period}</th><td className="p-3">{period.access_days}일</td><td className="p-3">{period.login_count}회</td></tr>)}</tbody></table></div>}
          </details>
        </li>)}</ul>}
        <nav className="mt-6 flex flex-wrap items-center justify-between gap-3" aria-label="사용량 페이지 이동"><button type="button" className="ca-secondary" disabled={loading || data.page <= 1} onClick={() => move(data.page - 1)}>이전</button><span className="text-sm">{data.page} / {Math.max(1, Math.ceil(data.total / data.page_size))} 페이지</span><button type="button" className="ca-secondary" disabled={loading || data.page * data.page_size >= data.total} onClick={() => move(data.page + 1)}>다음</button></nav>
      </>}
    </main>
  </div>;
}
