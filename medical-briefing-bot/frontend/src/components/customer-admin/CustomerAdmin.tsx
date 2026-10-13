'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Activity, ChevronDown, ChevronRight, LockKeyhole, LogOut, UserRound } from 'lucide-react';
import { adminRequest, AdminApiError, actionLabel, formatAdminDate, type UserResult, type AuditResult } from '@/lib/customerAdminApi';
import UserManagement from './UserManagement';
import { AddUsersDialog, ChangePasswordDialog, PasswordWarning } from './AccountDialogs';
import ActivityHistory from './ActivityHistory';
import AuditDialog from './AuditDialog';
import Dialog from './Dialog';
import './customer-admin.css';

type OpenDialog='add'|'bulk'|'password'|'history'|'password-history'|'account'|null;
export default function CustomerAdmin() {
  const router=useRouter();const [data,setData]=useState<UserResult|null>(null);const [audit,setAudit]=useState<AuditResult|null>(null);
  const [query,setQuery]=useState('');const [status,setStatus]=useState('all');const [page,setPage]=useState(1);const [revision,setRevision]=useState(0);
  const [dialog,setDialog]=useState<OpenDialog>(null);const [notice,setNotice]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [loading,setLoading]=useState(true);
  const unauthorized=useCallback(()=>{router.replace('/customer-admin/login');router.refresh();},[router]);
  const close=()=>setDialog(null);
  useEffect(()=>{
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      setLoading(true);
      try{const [users,events]=await Promise.all([adminRequest<UserResult>(`users?search=${encodeURIComponent(query)}&status=${status}&page=${page}&page_size=10`,{signal:controller.signal}),adminRequest<AuditResult>('audit?page_size=6',{signal:controller.signal})]);if(!controller.signal.aborted){setData(users);setAudit(events);setError('');if(users.total>0&&page>Math.ceil(users.total/10))setPage(Math.ceil(users.total/10));}}
      catch(e){if(!controller.signal.aborted){const failure=e as AdminApiError;setData(null);setError(failure.message);if(failure.status===401)unauthorized();}}
      finally{if(!controller.signal.aborted)setLoading(false);}
    },200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,status,page,revision,unauthorized]);
  useEffect(()=>{
    const check=()=>{adminRequest('session').catch(e=>{if(e.status===401){setData(null);unauthorized();}});};
    const timer=setInterval(check,60000);window.addEventListener('focus',check);
    return()=>{clearInterval(timer);window.removeEventListener('focus',check);};
  },[unauthorized]);
  async function mutate(path:string,body:unknown,method='POST') {
    try{await adminRequest(path,{method,body:JSON.stringify(body)});setRevision(v=>v+1);}
    catch(e){if(e instanceof AdminApiError&&e.status===401)unauthorized();throw e;}
  }
  async function add(numbers:string[]) {await mutate(dialog==='bulk'?'users/bulk':'users',dialog==='bulk'?{employee_numbers:numbers}:{employee_number:numbers[0]});setPage(1);close();setNotice(`${numbers.length}명의 사용자를 등록했습니다.`);}
  async function toggle(employeeNo:string){const user=data?.users.find(u=>u.employee_number===employeeNo);if(!user||busy)return;setBusy(true);try{await mutate(`users/${user.id}/status`,{active:!user.active},'PATCH');setNotice(`사번 ${employeeNo}의 상태를 변경했습니다.`);}catch(e){setNotice(e instanceof Error?e.message:'변경할 수 없습니다.');}finally{setBusy(false);}}
  const activities=audit?.events.map(e=>({id:e.id,at:formatAdminDate(e.occurred_at,true),action:actionLabel(e),actor:e.actor||'시스템'}))||[];
  return <div className="customer-admin min-h-screen bg-[#F7F9FC] text-slate-800"><header className="border-b border-slate-200/80 bg-white"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-4 py-5 sm:px-8 lg:px-10"><div className="flex items-center gap-3"><span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white"><Activity size={24}/></span><div><p className="text-lg font-bold">Medical Briefing</p><p className="mt-0.5 text-xs text-slate-500 sm:text-sm">의료 전문가를 위한 AI 브리핑 서비스</p></div></div><div className="flex w-full items-center justify-end gap-2 sm:w-auto"><button className="ca-secondary min-w-0 max-w-[calc(100%-6rem)]" onClick={()=>setDialog('account')} disabled={!data}><UserRound size={18}/><span className="min-w-0 break-all">관리자 {data?.admin.login_id||'…'}님</span><ChevronDown size={15}/></button><button className="ca-text-button px-2" disabled={busy} onClick={async()=>{setBusy(true);try{await adminRequest('logout',{method:'POST',body:'{}'});setData(null);unauthorized();}catch(e){setNotice(e instanceof Error?e.message:'로그아웃할 수 없습니다.');}finally{setBusy(false);}}}><LogOut size={16}/>로그아웃</button></div></div></header>
    <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-8 sm:py-10 lg:px-10"><div className="mb-7"><h1 className="text-2xl font-bold sm:text-3xl">고객 계정 관리</h1><p className="mt-3 text-sm text-slate-500 sm:text-base">서비스에 접근할 수 있는 사번을 관리합니다.</p></div><div role="status" aria-live="polite" aria-atomic="true">{notice&&<div className="mb-5 rounded-xl bg-blue-50 px-4 py-3 text-sm leading-6 text-blue-800">{notice}</div>}</div>
      {error?<div className="ca-card"><p role="alert" className="text-sm text-rose-700">{error}</p><button className="ca-secondary mt-4" onClick={()=>setRevision(v=>v+1)}>다시 시도</button></div>:!data?<p role="status" className="ca-card text-sm text-slate-500">관리 정보를 불러오는 중…</p>:<div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]"><UserManagement users={data.users.map(u=>({id:u.id,employeeNo:u.employee_number,active:u.active,createdAt:formatAdminDate(u.created_at),updatedAt:formatAdminDate(u.updated_at)}))} stats={data.stats} total={data.total} query={query} status={status} page={page} loading={busy||loading} onSearch={value=>{setQuery(value);setPage(1);}} onStatus={value=>{setStatus(value);setPage(1);}} onPage={setPage} onAdd={()=>setDialog('add')} onBulk={()=>setDialog('bulk')} onToggle={toggle}/><div className="grid min-w-0 gap-6 md:grid-cols-2 xl:grid-cols-1"><section className="ca-card min-w-0"><h2 className="ca-card-title"><LockKeyhole size={20} className="text-blue-600"/>공용 비밀번호</h2><p className="mt-3 text-sm leading-6 text-slate-500">모든 사용자가 공유하는 로그인 비밀번호입니다.</p><button className="ca-text-button mt-2" onClick={()=>setDialog('password-history')}>비밀번호 변경 이력<ChevronRight size={15}/></button><dl className="my-5 space-y-4 rounded-xl bg-slate-50 p-4 text-sm"><div className="flex flex-wrap justify-between gap-2"><dt className="text-slate-500">마지막 변경 (KST)</dt><dd>{formatAdminDate(data.credential.updated_at,true)}</dd></div><div className="flex justify-between"><dt className="text-slate-500">현재 상태</dt><dd className="text-emerald-700">{data.credential.configured?'● 정상':'미설정'}</dd></div></dl><PasswordWarning/><button className="ca-primary mt-5 w-full" disabled={!data.credential.configured} onClick={()=>setDialog('password')}>공용 비밀번호 변경</button></section><ActivityHistory activities={activities} onViewAll={()=>setDialog('history')}/></div></div>}
    </main>
    {(dialog==='add'||dialog==='bulk')&&<AddUsersDialog bulk={dialog==='bulk'} onClose={close} onAdd={add}/>}
    {dialog==='password'&&<ChangePasswordDialog onClose={close} onConfirm={async(password,confirmation,admin_password)=>{await mutate('shared-password',{password,confirmation,admin_password});close();setNotice('공용 비밀번호를 변경했습니다. 일반 사용자는 새 비밀번호로 다시 로그인해야 합니다.');}}/>}
    {(dialog==='history'||dialog==='password-history')&&<AuditDialog passwordOnly={dialog==='password-history'} onClose={close} onUnauthorized={unauthorized}/>}
    {dialog==='account'&&<Dialog title="관리자 정보" onClose={close}><p className="mt-4 text-sm">관리자 ID: {data?.admin.login_id}</p><button className="ca-primary mt-6" onClick={close}>확인</button></Dialog>}
  </div>;
}
