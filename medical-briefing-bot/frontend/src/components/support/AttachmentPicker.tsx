'use client';
import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { endpoint, supportFetch } from '@/lib/support/client';
import type { Audience } from '@/lib/support/contract';
import { fileTypes, MAX_BYTES, PART_BYTES, prepared, prepareAttachment } from '@/lib/support/attachments/contract';

export type SelectedAttachment = { key: string; file: File; id?: string; done?: boolean };
const ok = z.object({ ok: z.literal(true) });
export async function uploadAttachments(files: SelectedAttachment[], audience: Audience, requestId: string, progress: (message: string) => void) {
  const base = `${endpoint(audience)}/${requestId}/attachments`;
  for (const item of files) {
    if (item.done) continue;
    progress(`${item.file.name}: 파일 확인 중`);
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await item.file.arrayBuffer())), b => b.toString(16).padStart(2, '0')).join('');
    const extension = item.file.name.split('.').pop()?.toLowerCase();
    const mime = item.file.type || Object.entries(fileTypes).find(([key]) => key === extension)?.[1] || '';
    const data = prepareAttachment.parse({ client_key: item.key, original_name: item.file.name, mime, bytes: item.file.size, sha256 });
    const reservation = await supportFetch(base, prepared, { method: 'POST', body: JSON.stringify(data) });
    item.id = reservation.id;
    if (!reservation.uploaded) {
      for (let offset = 0, part = 0; offset < item.file.size; offset += PART_BYTES, part++) {
        const response = await fetch(`${base}/${reservation.id}/parts/${part}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'x-support-upload-token': reservation.token }, body: item.file.slice(offset, offset + PART_BYTES) });
        if (!response.ok) throw new Error(`${item.file.name}: 업로드에 실패했습니다. 다시 시도해 주세요.`);
        progress(`${item.file.name}: ${Math.round(Math.min(offset + PART_BYTES, item.file.size) / item.file.size * 100)}%`);
      }
      await supportFetch(`${base}/${reservation.id}/complete`, ok, { method: 'POST', headers: { 'x-support-upload-token': reservation.token } });
    }
    item.done = true;
  }
}
function Preview({ file }: { readonly file: File }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => { const value = URL.createObjectURL(file); if (image.current) image.current.src = value; return () => URL.revokeObjectURL(value); }, [file]);
  // Local previews never fetch an unscanned server object.
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={image} alt={`${file.name} 선택 미리보기`} className="h-24 w-24 rounded-lg object-contain"/>;
}
export function AttachmentPicker({ files, onChange, busy, existing = 0 }: { readonly files: SelectedAttachment[]; readonly onChange: (files: SelectedAttachment[]) => void; readonly busy: boolean; readonly existing?: number }) {
  const [error, setError] = useState('');
  function add(incoming: File[]) {
    if (busy) return;
    if (files.length + incoming.length + existing > 5) { setError('요청당 최대 5개까지 첨부할 수 있습니다.'); return; }
    if (incoming.some(file => file.size < 1 || file.size > MAX_BYTES || !Object.keys(fileTypes).some(extension => file.name.toLowerCase().endsWith(`.${extension}`)))) { setError('JPG, PNG, WEBP, PDF, DOCX, XLSX 파일만 첨부할 수 있습니다. 파일당 최대 10MB입니다.'); return; }
    setError(''); onChange([...files, ...incoming.map(file => ({ file, key: crypto.randomUUID() }))]);
  }
  return <section className="space-y-3" aria-label="파일 첨부" tabIndex={0} onPaste={event => { const images = Array.from(event.clipboardData.files).filter(file => ['image/jpeg','image/png','image/webp'].includes(file.type)); if (images.length) { event.preventDefault(); add(images); } }}>
    <label className="ca-label" htmlFor="support-files">첨부파일</label><input id="support-files" type="file" multiple accept={Object.keys(fileTypes).map(key => `.${key}`).join(',')} disabled={busy} className="ca-input" onChange={event => { add(Array.from(event.target.files || [])); event.target.value = ''; }}/>
    <p className="text-xs leading-6 text-slate-500">최대 5개 · 파일당 10MB · JPG, PNG, WEBP, PDF, DOCX, XLSX<br/>이 영역에서 클립보드 이미지를 붙여넣을 수 있습니다. 업로드 후 안전 검사 동안 다운로드가 제한됩니다.</p>
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    <ul className="space-y-3">{files.map(item => <li key={item.key} className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 p-3">{item.file.type.startsWith('image/') && <Preview file={item.file}/>}<span className="min-w-0 flex-1 break-all text-sm">{item.file.name}<small className="block text-slate-500">{(item.file.size / 1024).toFixed(1)} KB{item.done ? ' · 업로드 완료' : ''}</small></span><button type="button" className="support-button support-secondary" disabled={busy || Boolean(item.id)} onClick={() => onChange(files.filter(file => file.key !== item.key))} aria-label={`${item.file.name} 제거`}>제거</button></li>)}</ul>
  </section>;
}
