import Link from 'next/link';
import { AlertCircle } from 'lucide-react';
import { type SupportStatus, SupportClientError } from '@/lib/support/client';
import { boardLabels, displayStatus } from '@/lib/support/board';
import type { Audience } from '@/lib/support/contract';

export function StatusBadge({ status }: { readonly status: SupportStatus }) {
  const group = displayStatus(status);
  return <span className={`support-badge support-status-${group}`}>{boardLabels[group]}{status === 'cancelled' ? ' · 취소' : ''}</span>;
}
export function AttachmentUnavailable() {
  return <p className="support-notice" role="note">첨부파일 업로드는 아직 사용할 수 없습니다. 현재 첨부 기능이 비활성화되어 제목과 내용만 등록할 수 있습니다.</p>;
}
export function SupportFailure({ error, audience, retry }: { readonly error: Error; readonly audience: Audience; readonly retry?: () => void }) {
  const auth = error instanceof SupportClientError && error.status === 401;
  return <div className="support-alert" role="alert"><AlertCircle size={20} aria-hidden="true"/><div>
    <p>{error.message}</p>
    {auth ? <Link className="support-button support-secondary mt-3" href={audience === 'customer' ? '/customer-admin/login' : '/admin'}>다시 로그인</Link>
      : retry && <button className="support-button support-secondary mt-3" onClick={retry}>다시 시도</button>}
  </div></div>;
}
export function Pagination({ page, total, size = 10, busy = false, onPage }: {
  readonly page: number; readonly total: number; readonly size?: number; readonly busy?: boolean; readonly onPage: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return <nav aria-label="페이지 이동" className="support-pagination">
    <span>{page} / {pages} 페이지 · 총 {total}건</span><div className="flex gap-2">
      <button className="support-button support-secondary" disabled={busy || page <= 1} onClick={() => onPage(page - 1)}>이전</button>
      <button className="support-button support-secondary" disabled={busy || page >= pages} onClick={() => onPage(page + 1)}>다음</button>
    </div>
  </nav>;
}
