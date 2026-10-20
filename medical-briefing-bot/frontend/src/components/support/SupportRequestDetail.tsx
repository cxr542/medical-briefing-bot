'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, MessageSquare } from 'lucide-react';
import { internalChanged, message, statusChange, type Audience } from '@/lib/support/contract';
import { boardLabels, boardStatus, boardTransition, displayStatus } from '@/lib/support/board';
import { endpoint, formatSupportDate, loadDetail, SupportClientError, supportFetch, type CustomerDetail, type InternalDetail } from '@/lib/support/client';
import { AttachmentUnavailable, Pagination, StatusBadge, SupportFailure } from './SupportPrimitives';
import { AttachmentPanel } from './AttachmentPanel';

export function SupportRequestDetail({ id, audience, onBack, attachmentsEnabled = false }: { readonly id: string; readonly audience: Audience; readonly onBack: () => void; readonly attachmentsEnabled?: boolean }) {
  const [detail, setDetail] = useState<CustomerDetail | InternalDetail | null>(null);
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [target, setTarget] = useState('');
  const [answer, setAnswer] = useState('');
  const submitting = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadDetail(audience, id, page, controller.signal)
      .then(result => { if (!controller.signal.aborted) { setDetail(result); setError(null); } })
      .catch(error => { if (!controller.signal.aborted) { setDetail(null); setError(error instanceof Error ? error : new Error('요청을 불러올 수 없습니다.')); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [audience, id, page, revision]);
  function reload() { setDetail(null); setLoading(true); setRevision(value => value + 1); }
  async function mutate(event: FormEvent<HTMLFormElement>, operation: 'status' | 'comments') {
    event.preventDefault();
    if (!detail || submitting.current || conflict) return;
    const selected = boardStatus.safeParse(target);
    const reply = message.safeParse({ body: answer, version: detail.request.version });
    if (operation === 'status' ? !selected.success : !reply.success) { setError(new SupportClientError(400, 'INVALID_INPUT')); return; }
    submitting.current = true; setBusy(true); setError(null); setNotice('');
    let saved = false;
    try {
      if (operation === 'status' && selected.success) {
        let version = detail.request.version;
        const steps = boardTransition(detail.request.status, selected.data);
        if (!steps.length) throw new SupportClientError(400, 'INVALID_INPUT');
        for (const status of steps) {
          const payload = statusChange.parse({ status, reason: `CSR 게시판: ${boardLabels[selected.data]}로 변경`, version });
          const result = await supportFetch(`${endpoint(audience)}/${id}/status`, internalChanged, { method: 'PATCH', body: JSON.stringify(payload) });
          saved = true;
          version = result.request.version;
        }
        setTarget('');
      } else if (operation === 'comments' && reply.success) {
        await supportFetch(`${endpoint(audience)}/${id}/comments`, internalChanged, { method: 'POST', body: JSON.stringify(reply.data) });
        saved = true;
        setAnswer('');
      }
      setDetail(null);
      const latest = await loadDetail(audience, id, page);
      setDetail(latest);
      setNotice(operation === 'status' ? '처리 상태를 변경했습니다.' : '공개 답변을 등록했습니다.');
    } catch (error) {
      if (saved) { setDetail(null); setNotice('저장된 변경이 있습니다. 최신 내용을 다시 불러와 주세요.'); }
      else if (operation === 'status') { setDetail(null); setNotice('상태 변경을 완료하지 못했습니다. 일부 변경이 저장됐을 수 있으니 최신 상태를 확인한 뒤 다시 시도해 주세요.'); }
      if (error instanceof SupportClientError && error.status === 409) {
        setConflict(true); setDetail(null);
        try { setDetail(await loadDetail(audience, id, page)); }
        catch (refreshError) { setError(refreshError instanceof Error ? refreshError : new Error('최신 내용을 불러올 수 없습니다.')); }
      } else {
        setError(error instanceof Error ? error : new Error('저장할 수 없습니다.'));
        if (error instanceof SupportClientError && [401, 403, 404].includes(error.status)) setDetail(null);
        else if (saved || operation === 'status') {
          try { setDetail(await loadDetail(audience, id, page)); }
          catch { setDetail(null); }
        }
        else if (error instanceof SupportClientError && error.status === 503) setDetail(null);
      }
    } finally { submitting.current = false; setBusy(false); }
  }
  const internal = audience === 'internal' && detail && 'notes' in detail ? detail : null;
  const replyTotal = detail?.comments_total || 0;
  return <div><button className="support-button support-secondary mb-5" onClick={onBack} disabled={busy}><ArrowLeft size={16} aria-hidden="true"/>목록으로</button>
    <h2 ref={heading} tabIndex={-1} className="mb-5 text-xl font-bold">요청 상세</h2>
    <div role="status" aria-live="polite">{notice && <p className="support-notice mb-5">{notice}</p>}</div>
    {conflict && <div className="support-notice mb-5" role="alert"><p>다른 작업으로 요청이 변경되었습니다. 입력 내용은 보존했습니다. 최신 문의와 답변을 확인한 뒤 다시 저장해 주세요.</p><button className="support-button support-secondary mt-3" disabled={busy || !detail} onClick={() => { setConflict(false); setError(null); }}>최신 내용을 확인했습니다</button></div>}
    {error && <div className="mb-5"><SupportFailure error={error} audience={audience} retry={reload}/></div>}
    {loading ? <p className="support-card" role="status">요청을 불러오는 중…</p> : detail && <div className={internal ? 'support-detail-grid' : 'space-y-6'} aria-busy={busy}>
      <div className="min-w-0 space-y-6"><section className="support-card"><div className="mb-4 flex flex-wrap items-center gap-2"><span className="support-number">#{detail.request.request_number}</span><StatusBadge status={detail.request.status}/></div><h3 className="support-request-heading">{detail.request.title}</h3><dl className="support-meta"><div><dt>접수일 (KST)</dt><dd>{formatSupportDate(detail.request.created_at)}</dd></div><div><dt>최근 수정 (KST)</dt><dd>{formatSupportDate(detail.request.updated_at)}</dd></div></dl><p className="support-prose mt-6">{detail.request.description}</p>{detail.request.status === 'cancelled' && <p className="mt-4 text-sm text-slate-500">취소되어 종료된 문의입니다.</p>}</section>
        <section className="support-card"><h3 className="support-section-title"><MessageSquare size={20} aria-hidden="true"/>운영자 공개 답변</h3><p className="mt-2 text-xs text-slate-500">총 {detail.comments_total}건 · 최근 답변부터 표시</p>{detail.comments.length ? <ul className="support-feed">{detail.comments.map(comment => <li key={comment.id}><p className="support-prose">{comment.body}</p><time className="support-time" dateTime={comment.created_at}>{formatSupportDate(comment.created_at)}</time></li>)}</ul> : <p className="mt-5 text-sm text-slate-500">아직 등록된 공개 답변이 없습니다.</p>}</section>
        {attachmentsEnabled ? <AttachmentPanel requestId={id} audience={audience}/> : <AttachmentUnavailable/>}
        {replyTotal > 10 && <Pagination page={page} total={replyTotal} busy={busy} onPage={value => { setPage(value); setLoading(true); setDetail(null); }}/ >}
      </div>
      {internal && <aside className="min-w-0 space-y-6" aria-label="지원 요청 처리">{detail.request.status !== 'cancelled' && <form className="support-card space-y-4" onSubmit={event => void mutate(event, 'status')}><h3 className="support-section-title">처리 상태 변경</h3><div><label className="ca-label" htmlFor="support-target">변경할 상태</label><select id="support-target" className="ca-input" value={target} onChange={event => setTarget(event.target.value)} required disabled={busy || conflict}><option value="">상태 선택</option>{boardStatus.options.filter(status => status !== 'received' && status !== displayStatus(detail.request.status)).map(status => <option key={status} value={status}>{boardLabels[status]}</option>)}</select></div><button className="support-button support-primary w-full" disabled={busy || conflict}>{busy ? '저장 중…' : '상태 변경'}</button></form>}
        <form className="support-card space-y-4" onSubmit={event => void mutate(event, 'comments')}><h3 className="support-section-title">공개 답변 작성</h3><p className="text-sm leading-6 text-slate-500">등록한 답변은 고객에게 공개됩니다.</p><label className="ca-label" htmlFor="support-answer">답변 내용</label><textarea id="support-answer" className="ca-input" rows={5} maxLength={10000} required value={answer} onChange={event => setAnswer(event.target.value)} disabled={busy || conflict}/><button className="support-button support-primary w-full" disabled={busy || conflict}>{busy ? '저장 중…' : '공개 답변 등록'}</button></form>
      </aside>}
    </div>}
  </div>;
}
