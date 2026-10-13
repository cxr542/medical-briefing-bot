'use client';

import { useId, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { validateEmployeeNumbers, validateMockPassword, type CustomerUser } from '@/lib/customerAdminMockData';
import Dialog from './Dialog';

export function AddUsersDialog({ bulk, users, onClose, onAdd }: { bulk: boolean; users: CustomerUser[]; onClose: () => void; onAdd: (numbers: string[]) => void }) {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const id = useId();
  const result = validateEmployeeNumbers(input, users);
  const error = submitted || input.length > 0 ? result.error : '';
  return <Dialog title={bulk ? '사번 일괄 등록' : '사번 추가'} description={bulk ? '등록할 사번을 한 줄에 하나씩 입력하세요.' : '서비스 접근을 허용할 사번을 입력하세요.'} onClose={onClose}>
    <form className="mt-6" onSubmit={event => { event.preventDefault(); setSubmitted(true); if (!result.error) onAdd(result.numbers); }}>
      <label htmlFor={id} className="ca-label">{bulk ? '등록할 사번' : '사번'}</label>
      {bulk ? <textarea id={id} autoFocus rows={6} maxLength={2000} value={input} onChange={event => setInput(event.target.value)} placeholder={'100133\n100134\n100135\n100136'} className="ca-input resize-y" aria-invalid={Boolean(error)} aria-describedby={`${id}-help`} /> : <input id={id} autoFocus inputMode="numeric" maxLength={6} value={input} onChange={event => setInput(event.target.value)} placeholder="100133" className="ca-input" aria-invalid={Boolean(error)} aria-describedby={`${id}-help`} />}
      <p id={`${id}-help`} className={`mt-2 text-sm ${error ? 'text-rose-700' : 'text-slate-500'}`} aria-live="polite">{error || (bulk && result.numbers.length ? `${result.numbers.length}명의 사용자가 등록됩니다.` : '시안에서는 숫자 6자리 사번을 사용합니다.')}</p>
      <p className="mt-4 text-xs leading-5 text-slate-500">화면에서만 임시 등록되며 새로고침하면 초기화됩니다.</p>
      <div className="mt-6 flex justify-end gap-3"><button type="button" className="ca-secondary" onClick={onClose}>취소</button><button type="submit" className="ca-primary">{bulk ? `${result.numbers.length}명 등록` : '사번 추가'}</button></div>
    </form>
  </Dialog>;
}

export function ChangePasswordDialog({ onClose, onConfirm }: { onClose: () => void; onConfirm: () => void }) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const id = useId();
  return <Dialog title="공용 비밀번호 변경" description="새 비밀번호를 입력하고 확인해 주세요." onClose={onClose}>
    <form className="mt-6 space-y-4" onSubmit={event => { event.preventDefault(); const message = validateMockPassword(password, confirmation); setError(message); if (!message) { setPassword(''); setConfirmation(''); onConfirm(); } }}>
      <div><label htmlFor={`${id}-password`} className="ca-label">새 비밀번호</label><input id={`${id}-password`} type="password" autoFocus autoComplete="off" maxLength={128} value={password} onChange={event => { setPassword(event.target.value); setError(''); }} aria-describedby={`${id}-help`} className="ca-input" /><p id={`${id}-help`} className="mt-2 text-xs text-slate-500">시안 검증 기준: 12자 이상. 실제 비밀번호를 입력하지 마세요.</p></div>
      <div><label htmlFor={`${id}-confirmation`} className="ca-label">새 비밀번호 확인</label><input id={`${id}-confirmation`} type="password" autoComplete="off" maxLength={128} value={confirmation} onChange={event => { setConfirmation(event.target.value); setError(''); }} aria-invalid={Boolean(error)} aria-describedby={error ? `${id}-error` : undefined} className="ca-input" /></div>
      {error && <p id={`${id}-error`} role="alert" className="text-sm text-rose-700">{error}</p>}
      <PasswordWarning />
      <p className="text-xs leading-5 text-slate-500">이번 시안은 입력 검증만 수행합니다. 비밀번호를 저장·전송하지 않으며 실제 세션도 변경하지 않습니다.</p>
      <div className="flex justify-end gap-3 pt-2"><button type="button" className="ca-secondary" onClick={onClose}>취소</button><button type="submit" className="ca-primary">비밀번호 변경</button></div>
    </form>
  </Dialog>;
}

export function PasswordWarning() {
  return <div className="flex gap-3 rounded-xl border border-amber-100 bg-amber-50 p-4 text-amber-900"><TriangleAlert size={18} className="mt-0.5 shrink-0" /><div><p className="text-sm font-semibold leading-6">비밀번호를 변경하면 모든 사용자가 다시 로그인해야 합니다.</p><p className="mt-1 text-xs leading-5 text-amber-800">변경 즉시 현재 로그인된 일반 사용자들의 세션이 만료됩니다.</p></div></div>;
}
