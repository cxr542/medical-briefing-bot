'use client';
import { useRef, useState, type FormEvent } from 'react';
import Dialog from '@/components/customer-admin/Dialog';
import { createRequest, customerCreated } from '@/lib/support/contract';
import { endpoint, supportFetch } from '@/lib/support/client';
import { AttachmentPicker, uploadAttachments, type SelectedAttachment } from './AttachmentPicker';
import { AttachmentUnavailable } from './SupportPrimitives';

export function NewRequestDialog({ onClose, onCreated, attachmentsEnabled = false }: { readonly onClose: () => void; readonly onCreated: (id: string) => void; readonly attachmentsEnabled?: boolean }) {
  const created = useRef<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const retryKey = useRef<string | null>(null);
  const [files, setFiles] = useState<SelectedAttachment[]>([]);
  const [progress, setProgress] = useState('');
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
      if (!created.current) {
        retryKey.current ??= crypto.randomUUID();
        const result = await supportFetch(endpoint('customer'), customerCreated, { method: 'POST', body: JSON.stringify(parsed.data), ...(attachmentsEnabled ? { headers: { 'x-support-request-key': retryKey.current } } : {}) });
        created.current = result.request.id;
        setCreatedId(result.request.id);
      }
      if (attachmentsEnabled) await uploadAttachments(files, 'customer', created.current, setProgress);
      onCreated(created.current);
    } catch (error) { setError(error instanceof Error ? error.message : '요청을 등록할 수 없습니다.'); }
    finally { submitting.current = false; setBusy(false); }
  }
  function close() { if (!submitting.current) { if (created.current) onCreated(created.current); else onClose(); } }
  return <Dialog title="새 문의 등록" description="궁금한 점이나 불편한 내용을 남겨 주세요." onClose={close}>
    <form className="mt-6 space-y-5" onSubmit={submit} aria-busy={busy}>
      <div><label htmlFor="support-title" className="ca-label">제목 <span className="text-slate-500">(필수)</span></label><input id="support-title" name="title" className="ca-input" required maxLength={200} disabled={busy} readOnly={Boolean(createdId)}/></div>
      <div><label htmlFor="support-description" className="ca-label">상세 내용 <span className="text-slate-500">(필수)</span></label><textarea id="support-description" name="description" className="ca-input" rows={7} required maxLength={10000} disabled={busy} readOnly={Boolean(createdId)}/><p className="mt-2 text-xs text-slate-500">비밀번호와 개인정보는 입력하지 마세요. 최대 10,000자</p></div>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {attachmentsEnabled ? <AttachmentPicker files={files} onChange={setFiles} busy={busy}/> : <AttachmentUnavailable/>}
      <p role="status" aria-live="polite" className="text-sm text-slate-500">{progress}{createdId && error ? ' · 요청은 등록되었습니다. 첨부만 다시 시도하거나 상세 화면에서 이어서 처리할 수 있습니다.' : ''}</p>
      <div className="flex justify-end gap-2"><button type="button" className="ca-secondary" onClick={close} disabled={busy}>{createdId ? '요청 상세로' : '취소'}</button><button className="ca-primary" disabled={busy}>{busy ? '등록 중…' : createdId ? '첨부 재시도' : '요청 등록'}</button></div>
    </form>
  </Dialog>;
}
