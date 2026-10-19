'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import type { Audience } from '@/lib/support/contract';
import { attachmentList, type Attachment } from '@/lib/support/attachments/contract';
import { endpoint, supportFetch } from '@/lib/support/client';
import { AttachmentPicker, uploadAttachments, type SelectedAttachment } from './AttachmentPicker';

const labels = { pending: '검사 대기', scanning: '안전 검사 중', clean: '검사 완료', infected: '위험 파일 격리', failed: '검사 실패 · 다운로드 차단' };
export function AttachmentPanel({ requestId, audience }: { readonly requestId: string; readonly audience: Audience }) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [files, setFiles] = useState<SelectedAttachment[]>([]);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const active = useRef(false);
  const base = `${endpoint(audience)}/${requestId}/attachments`;
  useEffect(() => {
    const controller = new AbortController();
    void supportFetch(base, attachmentList, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setItems(data.attachments); setError(''); } }).catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '첨부파일을 불러올 수 없습니다.'); });
    return () => controller.abort();
  }, [base, revision]);
  async function upload() {
    if (active.current) return;
    active.current = true; setBusy(true); setError('');
    try { await uploadAttachments(files, audience, requestId, setProgress); setFiles([]); setProgress('업로드 완료 · 안전 검사 대기'); setRevision(value => value + 1); }
    catch (error) { setError(error instanceof Error ? error.message : '업로드에 실패했습니다. 다시 시도해 주세요.'); }
    finally { active.current = false; setBusy(false); }
  }
  async function remove(id: string) {
    if (active.current) return;
    active.current = true; setBusy(true);
    try { await supportFetch(`${base}/${id}`, z.object({ ok: z.literal(true) }), { method: 'DELETE' }); setRevision(value => value + 1); }
    catch (error) { setError(error instanceof Error ? error.message : '삭제할 수 없습니다.'); }
    finally { active.current = false; setBusy(false); }
  }
  return <section className="support-card space-y-4" aria-label="요청 첨부파일" aria-busy={busy}><div className="flex flex-wrap items-center justify-between gap-3"><h3 className="support-section-title">요청 첨부파일</h3><button className="support-button support-secondary" disabled={busy} onClick={() => setRevision(value => value + 1)}>검사 상태 새로고침</button></div>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}<p role="status" aria-live="polite" className="text-sm text-slate-500">{progress}</p>
    <ul className="space-y-4">{items.map(item => <li key={item.id} className="rounded-lg border border-slate-200 p-4"><p className="break-all font-semibold">{item.original_name}</p><p className="my-2 text-sm text-slate-500">{(item.bytes / 1024).toFixed(1)} KB · {item.upload_status === 'reserved' ? '업로드 미완료' : labels[item.scan_status]}</p>
      {item.scan_status === 'clean' && <>{item.mime.startsWith('image/') && <a href={`${base}/${item.id}/download`} aria-label={`${item.original_name} 다운로드`}>
        {/* Authenticated previews are served only after the clean verdict. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`${base}/${item.id}/download?preview=1`} alt={item.original_name} className="mb-3 h-24 w-24 rounded-lg object-contain"/></a>}<a className="support-button support-secondary" href={`${base}/${item.id}/download`}>다운로드</a></>}
      <button className="support-button support-secondary ml-2" disabled={busy} onClick={() => void remove(item.id)} aria-label={`${item.original_name} 첨부 삭제`}>첨부 삭제</button></li>)}</ul>
    {!items.length && <p className="text-sm text-slate-500">첨부파일이 없습니다.</p>}
    <AttachmentPicker files={files} onChange={setFiles} busy={busy} existing={items.filter(item => !files.some(file => file.id === item.id)).length}/>
    {files.length > 0 && <button className="support-button support-primary" disabled={busy} onClick={() => void upload()}>{busy ? '업로드 중…' : '첨부 업로드 / 재시도'}</button>}
  </section>;
}
