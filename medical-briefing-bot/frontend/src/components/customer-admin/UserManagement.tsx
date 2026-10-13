'use client';

import { useState } from 'react';
import { Users, UserCheck, UserMinus, Search, Plus, ListPlus, MoreHorizontal, ChevronLeft, ChevronRight } from 'lucide-react';
import type { CustomerUser } from '@/lib/customerAdminMockData';

function UserActions({ user, onToggle }: { user: CustomerUser; onToggle: (employeeNo: string) => void }) {
  const [open, setOpen] = useState(false);
  return <div className="relative" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); event.currentTarget.querySelector('button')?.focus(); } }}>
    <button type="button" className="ca-icon-button" aria-label={`사번 ${user.employeeNo} 관리`} aria-expanded={open} onClick={() => setOpen(!open)}><MoreHorizontal size={20} /></button>
    {open && <div className="absolute right-0 top-11 z-10 min-w-36 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"><button type="button" className="min-h-11 w-full rounded-lg px-3 text-left text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600" onClick={() => { onToggle(user.employeeNo); setOpen(false); }}>{user.active ? '비활성화' : '다시 활성화'}</button></div>}
  </div>;
}

export default function UserManagement({ users, onAdd, onBulk, onToggle }: { users: CustomerUser[]; onAdd: () => void; onBulk: () => void; onToggle: (employeeNo: string) => void }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const filtered = users.filter(user => user.employeeNo.includes(query.trim()));
  const pageCount = Math.max(1, Math.ceil(filtered.length / 10));
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * 10;
  const shown = filtered.slice(start, start + 10);
  const active = users.filter(user => user.active).length;
  return <section className="ca-card min-w-0" aria-labelledby="users-title">
    <h2 id="users-title" className="ca-card-title"><Users size={20} className="text-blue-600" />사용자 관리</h2>
    <div className="mt-6 grid grid-cols-3 gap-2 sm:gap-3">
      {[{ label: '등록 사용자', count: users.length, Icon: Users, color: 'text-blue-600 bg-blue-50' }, { label: '활성 사용자', count: active, Icon: UserCheck, color: 'text-emerald-700 bg-emerald-50' }, { label: '비활성 사용자', count: users.length - active, Icon: UserMinus, color: 'text-rose-600 bg-rose-50' }].map(({ label, count, Icon, color }) => <div key={label} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-3 sm:p-4"><span className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl ${color}`}><Icon size={18} /></span><p className="text-[11px] text-slate-500 sm:text-xs">{label}</p><p className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">{count}<span className="ml-1 text-sm font-medium text-slate-500">명</span></p></div>)}
    </div>
    <div className="mt-6 flex flex-wrap gap-3">
      <div className="relative min-w-0 flex-1 basis-full sm:basis-40"><Search size={18} className="pointer-events-none absolute left-3 top-3.5 text-slate-400" /><label htmlFor="employee-search" className="sr-only">사번 검색</label><input id="employee-search" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} placeholder="사번으로 검색하세요." className="ca-input pl-10" /></div>
      <button type="button" className="ca-primary flex-1 sm:flex-none" onClick={onAdd}><Plus size={17} />사번 추가</button><button type="button" className="ca-secondary flex-1 sm:flex-none" onClick={onBulk}><ListPlus size={17} />일괄 등록</button>
    </div>
    <div className="mt-5 hidden sm:block"><table className="w-full text-left text-sm"><thead><tr className="border-y border-slate-100 bg-slate-50/80 text-xs text-slate-500">{['사번', '상태', '등록일', '최근 변경일', '관리'].map(label => <th key={label} scope="col" className="px-2 py-3 font-medium">{label}</th>)}</tr></thead><tbody>{shown.map(user => <tr key={user.employeeNo} className="border-b border-slate-100"><th scope="row" className="px-2 py-3 font-semibold tabular-nums">{user.employeeNo}</th><td className="px-2 py-3"><Status active={user.active} /></td><td className="px-2 py-3 text-xs text-slate-500 tabular-nums">{user.createdAt}</td><td className="px-2 py-3 text-xs text-slate-500 tabular-nums">{user.updatedAt}</td><td className="px-2"><UserActions user={user} onToggle={onToggle} /></td></tr>)}</tbody></table></div>
    <ul className="mt-5 divide-y divide-slate-100 sm:hidden">{shown.map(user => <li key={user.employeeNo} className="py-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><span className="font-semibold tabular-nums">{user.employeeNo}</span><Status active={user.active} /></div><UserActions user={user} onToggle={onToggle} /></div><dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500"><div className="flex gap-2"><dt>등록일</dt><dd>{user.createdAt}</dd></div><div className="flex gap-2"><dt>최근 변경일</dt><dd>{user.updatedAt}</dd></div></dl></li>)}</ul>
    {!shown.length && <p className="py-12 text-center text-sm text-slate-500">검색 결과가 없습니다.</p>}
    <div className="mt-5 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500" aria-live="polite">{query ? '검색 결과' : '전체'} {filtered.length}명 중 {shown.length ? `${start + 1}–${start + shown.length}` : '0'}명 표시</p><nav aria-label="사용자 목록 페이지" className="flex items-center gap-1"><button className="ca-icon-button" aria-label="이전 페이지" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={18} /></button><span aria-current="page" className="flex h-9 min-w-9 items-center justify-center rounded-lg bg-blue-50 text-sm font-semibold text-blue-700">{currentPage}</span><button className="ca-icon-button" aria-label="다음 페이지" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight size={18} /></button></nav></div>
  </section>;
}

function Status({ active }: { active: boolean }) {
  return <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-1 text-xs font-medium ${active ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}><span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-emerald-500' : 'bg-rose-500'}`} />{active ? '활성' : '비활성'}</span>;
}
