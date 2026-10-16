'use client';
import { useRef, useState, type FormEvent } from 'react';
import Dialog from '@/components/customer-admin/Dialog';
import { createRequest, customerCreated } from '@/lib/support/contract';
import { endpoint, priorityLabels, supportFetch } from '@/lib/support/client';

export function NewRequestDialog({ onClose, onCreated }: { readonly onClose: () => void; readonly onCreated: (id: string) => void }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const fields = new FormData(event.currentTarget);
    const parsed = createRequest.safeParse(Object.fromEntries(fields));
    if (!parsed.success) { setError('제목과 상세 내용을 확인해 주세요. 제목은 200자, 상세 내용은 10,000자까지 입력할 수 있습니다.'); return; }
    submitting.current = true; setBusy(true); setError('');
    try {
      const result = await supportFetch(endpoint('customer'), customerCreated, { method: 'POST', body: JSON.stringify(parsed.data) });
      onCreated(result.request.id);
    } catch (error) { setError(error instanceof Error ? error.message : '요청을 등록할 수 없습니다.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <Dialog title="새 기술지원 요청" description="문제가 발생한 상황과 기대하는 동작을 알려 주세요." onClose={() => { if (!submitting.current) onClose(); }}>
    <form className="mt-6 space-y-5" onSubmit={submit} aria-busy={busy}>
      <div><label htmlFor="support-title" className="ca-label">제목 <span className="text-slate-500">(필수)</span></label><input id="support-title" name="title" className="ca-input" required maxLength={200} disabled={busy}/></div>
      <div><label htmlFor="support-description" className="ca-label">상세 내용 <span className="text-slate-500">(필수)</span></label><textarea id="support-description" name="description" className="ca-input" rows={7} required maxLength={10000} disabled={busy}/><p className="mt-2 text-xs text-slate-500">비밀번호와 개인정보는 입력하지 마세요. 최대 10,000자</p></div>
      <div><label htmlFor="support-priority" className="ca-label">우선순위</label><select id="support-priority" name="priority" className="ca-input" defaultValue="normal" disabled={busy}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="flex justify-end gap-2"><button type="button" className="ca-secondary" onClick={onClose} disabled={busy}>취소</button><button className="ca-primary" disabled={busy}>{busy ? '등록 중…' : '요청 등록'}</button></div>
    </form>
  </Dialog>;
}
