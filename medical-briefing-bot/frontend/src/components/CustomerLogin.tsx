 'use client';
import { useState, useSyncExternalStore } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { safeUserNext } from '@/lib/customerReturn';
const subscribe=()=>()=>{};
export default function CustomerLogin({next}:{next:string}) {
  const ready=useSyncExternalStore(subscribe,()=>true,()=>false);
  const [identifier,setIdentifier]=useState('');
  const [password,setPassword]=useState('');
  const [passwordVisible,setPasswordVisible]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  return <main className="flex min-h-screen items-center justify-center bg-slate-50 p-4"><section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8"><h1 className="mb-8 text-2xl font-bold text-blue-700">Medical Briefing</h1><form className="space-y-5" onSubmit={async event=>{
    event.preventDefault();if(busy)return;setBusy(true);setError('');setPasswordVisible(false);
    try {const response=await fetch('/api/customer-auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({identifier,password}),cache:'no-store'});
      if(!response.ok) {setError(response.status===429?'잠시 후 다시 시도해 주세요.':response.status===503?'인증 서비스를 사용할 수 없습니다.':'사번 또는 비밀번호를 확인해 주세요.');return;}
      window.location.replace(safeUserNext(next));
    } catch {setError('인증 서비스를 사용할 수 없습니다.');} finally {setPassword('');setBusy(false);}
  }}><div><label htmlFor="employee" className="mb-2 block text-sm font-semibold text-slate-700">사번</label><input disabled={!ready||busy} id="employee" autoComplete="username" required maxLength={64} value={identifier} onChange={e=>setIdentifier(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 px-3"/></div><div><label htmlFor="shared-password" className="mb-2 block text-sm font-semibold text-slate-700">공용 비밀번호</label><div className="relative"><input disabled={!ready||busy} id="shared-password" type={passwordVisible ? 'text' : 'password'} autoComplete="current-password" required maxLength={512} value={password} onChange={e=>setPassword(e.target.value)} className="min-h-11 w-full rounded-xl border border-slate-300 pl-3 pr-12 text-slate-900"/><button type="button" disabled={!ready||busy} aria-label={passwordVisible ? '비밀번호 숨기기' : '비밀번호 보기'} title={passwordVisible ? '비밀번호 숨기기' : '비밀번호 보기'} aria-controls="shared-password" aria-pressed={passwordVisible} onClick={()=>setPasswordVisible(visible=>!visible)} className="absolute inset-y-0 right-0 flex w-11 items-center justify-center rounded-xl text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 disabled:opacity-50">{passwordVisible ? <EyeOff className="h-5 w-5" aria-hidden="true"/> : <Eye className="h-5 w-5" aria-hidden="true"/>}</button></div></div>{error&&<p role="alert" className="text-sm text-rose-700">{error}</p>}<button disabled={!ready||busy} className="min-h-11 w-full rounded-xl bg-blue-700 px-4 font-semibold text-white disabled:opacity-50">{busy?'로그인 중…':'로그인'}</button></form></section></main>;
}
