'use client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, LockKeyhole, MessageSquare } from 'lucide-react';
import { internalChanged, message, statusChange, statuses, type Audience } from '@/lib/support/contract';
import { endpoint, formatSupportDate, loadDetail, priorityLabels, statusLabels, SupportClientError, supportFetch, type CustomerDetail, type InternalDetail } from '@/lib/support/client';
import { Pagination, StatusBadge, SupportFailure } from './SupportPrimitives';
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
  const [reason, setReason] = useState('');
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState('');
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
  async function mutate(event: FormEvent<HTMLFormElement>, operation: 'status' | 'comments' | 'notes') {
    event.preventDefault();
    if (!detail || submitting.current || conflict) return;
    const payload = operation === 'status'
      ? statusChange.safeParse({ status: target, reason, version: detail.request.version })
      : message.safeParse({ body: operation === 'comments' ? answer : note, version: detail.request.version });
    if (!payload.success) { setError(new SupportClientError(400, 'INVALID_INPUT')); return; }
    submitting.current = true; setBusy(true); setError(null); setNotice('');
    let saved = false;
    try {
      await supportFetch(`${endpoint(audience)}/${id}/${operation}`, internalChanged, {
        method: operation === 'status' ? 'PATCH' : 'POST', body: JSON.stringify(payload.data),
      });
      saved = true;
      if (operation === 'status') { setReason(''); setTarget(''); }
      else if (operation === 'comments') setAnswer('');
      else setNote('');
      // A completed mutation must not leave a stale version available for another save.
      setDetail(null);
      const latest = await loadDetail(audience, id, page);
      setDetail(latest);
      setNotice(operation === 'status' ? '처리 상태를 변경했습니다.' : operation === 'comments' ? '공개 답변을 등록했습니다.' : '내부 메모를 등록했습니다.');
    } catch (error) {
      if (saved) setNotice('저장했습니다. 최신 내용을 다시 불러와 주세요.');
      if (error instanceof SupportClientError && error.status === 409) {
        setConflict(true); setDetail(null);
        try { setDetail(await loadDetail(audience, id, page)); }
        catch (refreshError) { setError(refreshError instanceof Error ? refreshError : new Error('최신 내용을 불러올 수 없습니다.')); }
      } else {
        setError(error instanceof Error ? error : new Error('저장할 수 없습니다.'));
        if (error instanceof SupportClientError && [401, 403, 404, 503].includes(error.status)) setDetail(null);
      }
    } finally { submitting.current = false; setBusy(false); }
  }
  const internal = audience === 'internal' && detail && 'notes' in detail ? detail : null;
  const historyTotal = internal ? Math.max(internal.comments_total, internal.notes_total, internal.history_total, internal.audit_total) : detail?.comments_total || 0;
  return <div><button className="support-button support-secondary mb-5" onClick={onBack} disabled={busy}><ArrowLeft size={16} aria-hidden="true"/>목록으로</button>
    <h2 ref={heading} tabIndex={-1} className="mb-5 text-xl font-bold">요청 상세</h2>
    <div role="status" aria-live="polite">{notice && <p className="support-notice mb-5">{notice}</p>}</div>
    {conflict && <div className="support-notice mb-5" role="alert"><p>다른 작업으로 요청이 변경되었습니다. 입력 내용은 보존했습니다. 최신 요청과 처리 이력을 확인한 뒤 다시 저장해 주세요.</p><button className="support-button support-secondary mt-3" disabled={busy || !detail} onClick={() => { setConflict(false); setError(null); }}>최신 내용을 확인했습니다</button></div>}
    {error && <div className="mb-5"><SupportFailure error={error} audience={audience} retry={reload}/></div>}
    {loading ? <p className="support-card" role="status">요청을 불러오는 중…</p> : detail && <div className={internal ? 'support-detail-grid' : 'space-y-6'} aria-busy={busy}>
      <div className="min-w-0 space-y-6"><section className="support-card"><div className="mb-4 flex flex-wrap items-center gap-2"><span className="support-number">#{detail.request.request_number}</span><StatusBadge status={detail.request.status}/><span className="support-priority">우선순위 {priorityLabels[detail.request.priority]}</span></div><h3 className="support-request-heading">{detail.request.title}</h3><dl className="support-meta"><div><dt>접수일 (KST)</dt><dd>{formatSupportDate(detail.request.created_at)}</dd></div><div><dt>최근 수정 (KST)</dt><dd>{formatSupportDate(detail.request.updated_at)}</dd></div></dl><p className="support-prose mt-6">{detail.request.description}</p></section>
        <section className="support-card"><h3 className="support-section-title"><MessageSquare size={20} aria-hidden="true"/>운영자 공개 답변</h3><p className="mt-2 text-xs text-slate-500">총 {detail.comments_total}건 · 최근 답변부터 표시</p>{detail.comments.length ? <ul className="support-feed">{detail.comments.map(comment => <li key={comment.id}><p className="support-prose">{comment.body}</p><time className="support-time" dateTime={comment.created_at}>{formatSupportDate(comment.created_at)}</time></li>)}</ul> : <p className="mt-5 text-sm text-slate-500">아직 등록된 공개 답변이 없습니다.</p>}</section>
        {attachmentsEnabled && <AttachmentPanel requestId={id} audience={audience}/>}
        {internal && <>
          <section className="support-card"><h3 className="support-section-title"><LockKeyhole size={20} aria-hidden="true"/>내부 메모</h3><p className="mt-2 text-xs text-slate-500">고객에게 공개되지 않습니다. · 총 {internal.notes_total}건</p>{internal.notes.length ? <ul className="support-feed">{internal.notes.map(item => <li key={item.id}><p className="support-prose">{item.body}</p><time className="support-time" dateTime={item.created_at}>{formatSupportDate(item.created_at)}</time></li>)}</ul> : <p className="mt-5 text-sm text-slate-500">내부 메모가 없습니다.</p>}</section>
          <section className="support-card"><h3 className="support-section-title">처리 이력</h3><p className="mt-2 text-xs text-slate-500">총 {internal.history_total}건</p><ul className="support-feed">{internal.history.map(item => <li key={item.id}><p className="text-sm font-semibold">{item.previous_status ? `${statusLabels[item.previous_status]} → ` : ''}{statusLabels[item.new_status]}</p><p className="support-prose mt-2">{item.reason}</p><time className="support-time" dateTime={item.created_at}>{formatSupportDate(item.created_at)}</time></li>)}</ul></section>
          <section className="support-card"><h3 className="support-section-title">감사 이력</h3><p className="mt-2 text-xs text-slate-500">총 {internal.audit_total}건 · 운영 작업 세션 기준</p><ul className="support-feed">{internal.audit.map(item => <li key={item.id}><p className="text-sm font-semibold">{{ request_created: '요청 등록', status_changed: '상태 변경', comment_created: '공개 답변 등록', note_created: '내부 메모 등록' }[item.action] || '지원 작업'}</p><p className="support-prose mt-2 text-xs">작업 세션: {item.actor_id}</p><time className="support-time" dateTime={item.created_at}>{formatSupportDate(item.created_at)}</time></li>)}</ul></section>
        </>}
        {historyTotal > 10 && <Pagination page={page} total={historyTotal} busy={busy} onPage={value => { setPage(value); setLoading(true); setDetail(null); }}/ >}
      </div>
      {internal && <aside className="min-w-0 space-y-6" aria-label="지원 요청 처리"><form className="support-card space-y-4" onSubmit={event => void mutate(event, 'status')}><h3 className="support-section-title">처리 상태 변경</h3><div><label className="ca-label" htmlFor="support-target">변경할 상태</label><select id="support-target" className="ca-input" value={target} onChange={event => setTarget(event.target.value)} required disabled={busy || conflict}><option value="">상태 선택</option>{statuses.map(status => <option key={status} value={status}>{statusLabels[status]}</option>)}</select></div><div><label className="ca-label" htmlFor="support-reason">변경 사유</label><textarea id="support-reason" className="ca-input" rows={3} maxLength={2000} required value={reason} onChange={event => setReason(event.target.value)} disabled={busy || conflict}/></div><button className="support-button support-primary w-full" disabled={busy || conflict}>{busy ? '저장 중…' : '상태 변경'}</button></form>
        <form className="support-card space-y-4" onSubmit={event => void mutate(event, 'comments')}><h3 className="support-section-title">공개 답변 작성</h3><p className="text-sm leading-6 text-slate-500">등록한 답변은 고객에게 공개됩니다.</p><label className="ca-label" htmlFor="support-answer">답변 내용</label><textarea id="support-answer" className="ca-input" rows={5} maxLength={10000} required value={answer} onChange={event => setAnswer(event.target.value)} disabled={busy || conflict}/><button className="support-button support-primary w-full" disabled={busy || conflict}>{busy ? '저장 중…' : '공개 답변 등록'}</button></form>
        <form className="support-card space-y-4" onSubmit={event => void mutate(event, 'notes')}><h3 className="support-section-title">내부 메모 작성</h3><p className="text-sm leading-6 text-slate-500">고객에게 공개되지 않는 운영 메모입니다.</p><label className="ca-label" htmlFor="support-note">메모 내용</label><textarea id="support-note" className="ca-input" rows={4} maxLength={10000} required value={note} onChange={event => setNote(event.target.value)} disabled={busy || conflict}/><button className="support-button support-secondary w-full" disabled={busy || conflict}>{busy ? '저장 중…' : '내부 메모 등록'}</button></form>
      </aside>}
    </div>}
  </div>;
}
