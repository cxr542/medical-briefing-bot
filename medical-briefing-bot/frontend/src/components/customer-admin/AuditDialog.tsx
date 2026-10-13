'use client';
import { useEffect, useState } from 'react';
import { adminRequest, actionLabel, formatAdminDate, type AuditResult } from '@/lib/customerAdminApi';
import Dialog from './Dialog';
import { ActivityList } from './ActivityHistory';
export default function AuditDialog({passwordOnly,onClose,onUnauthorized}:{passwordOnly:boolean;onClose:()=>void;onUnauthorized:()=>void}) {
  const [page,setPage]=useState(1);const [data,setData]=useState<AuditResult|null>(null);const [error,setError]=useState('');
  useEffect(()=>{const controller=new AbortController();adminRequest<AuditResult>(`audit?page=${page}&page_size=10&action=${passwordOnly?'shared_password_changed':'all'}`,{signal:controller.signal}).then(result=>{setData(result);setError('');}).catch(e=>{if(!controller.signal.aborted){if(e.status===401)onUnauthorized();else setError(e.message);}});return()=>controller.abort();},[page,passwordOnly,onUnauthorized]);
  return <Dialog title={passwordOnly?'비밀번호 변경 이력':'전체 관리 이력'} onClose={onClose}>{error?<p role="alert" className="mt-4 text-sm text-rose-700">{error}</p>:data?<><ActivityList activities={data.events.map(e=>({id:e.id,at:formatAdminDate(e.occurred_at,true),action:actionLabel(e),actor:e.actor||'시스템'}))}/>{data.events.length===0&&<p className="mt-5 text-sm text-slate-500">관리 이력이 없습니다.</p>}<div className="mt-4 flex items-center justify-between"><button className="ca-secondary" disabled={page===1} onClick={()=>{setData(null);setPage(page-1);}}>이전</button><span className="text-xs text-slate-500">{page} / {Math.max(1,Math.ceil(data.total/10))}</span><button className="ca-secondary" disabled={page*10>=data.total} onClick={()=>{setData(null);setPage(page+1);}}>다음</button></div></>:<p role="status" className="mt-4 text-sm text-slate-500">이력을 불러오는 중…</p>}</Dialog>;
}
