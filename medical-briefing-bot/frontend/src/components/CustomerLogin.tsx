 'use client';
import { useState } from 'react';
import { safeUserNext } from '@/lib/customerReturn';
export default function CustomerLogin({next}:{next:string}) {
  const [identifier,setIdentifier]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h1 className="mb-8 text-2xl font-bold text-blue-700">Medical Briefing</h1><form className="space-y-5" onSubmit={async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setError('');
    try {const response=await fetch('/api/customer-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,password}),cache:'no-store'});
      if(!response.ok) {setError(response.status===429?'잠시 후 다시 시도해 주세요.':response.status===503?'인증 서비스를 사용할 수 없습니다.':'사번 또는 비밀번호를 확인해 주세요.');return;}
      window.location.replace(safeUserNext(next));
    } catch {setError('인증 서비스를 사용할 수 없습니다.');} finally {setPassword('');setBusy(false);}
  }}><div><label htmlFor="employee" className="mb-2 block text-sm font-semibold text-slate-700">사번</label><input id="employee" autoComplete="username" required maxLength={64} value={identifier} onChange={e=>setIdentifier(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3"/></div><div><label htmlFor="shared-password" className="mb-2 block text-sm font-semibold text-slate-700">공용 비밀번호</label><input id="shared-password" type="password" autoComplete="current-password" required maxLength={512} value={password} onChange={e=>setPassword(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3"/></div>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}<button disabled={busy} className="min-h-11 w-full rounded-xl bg-blue-700 px-4 font-semibold text-white disabled:opacity-50">{busy?'로그인 중…':'로그인'}</button></form></section></main>;
}
