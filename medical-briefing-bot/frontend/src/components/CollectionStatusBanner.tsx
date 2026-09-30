'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { AlertTriangle, Calendar, ChevronDown, Clock, XCircle } from 'lucide-react';
import { getCollectionServiceErrorStatus, userSourceStatusLabel, type CollectionServiceStatus } from '@/lib/collectionStatus';
import { formatKstTimestamp } from '@/lib/adminMonitoringFormatters.mjs';

const CollectionStatusContext = createContext<CollectionServiceStatus | null>(null);

export function CollectionStatusProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<CollectionServiceStatus | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/collection-status', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('status unavailable');
        setStatus(await response.json() as CollectionServiceStatus);
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus(getCollectionServiceErrorStatus());
      });

    return () => controller.abort();
  }, []);

  return <CollectionStatusContext.Provider value={status}>{children}</CollectionStatusContext.Provider>;
}

export function CollectionLastCheck() {
  const status = useContext(CollectionStatusContext);
  const value = status === null
    ? '확인 중'
    : status.finishedAt
      ? formatKstTimestamp(status.finishedAt)
      : '기록 없음';

  return (
    <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 shadow-sm md:px-4">
      <Calendar className="h-4 w-4 text-[#1D4ED8]" aria-hidden="true" />
      <span aria-live="polite">마지막 수집 확인 {value}</span>
    </div>
  );
}

export default function CollectionStatusBanner() {
  const status = useContext(CollectionStatusContext);
  const [expanded, setExpanded] = useState(false);

  if (!status?.showBanner) return null;

  const isStale = status.state === 'STALE';
  const isFailed = status.state === 'FAILED';
  const isError = status.state === 'ERROR';
  const Icon = isFailed || isError ? XCircle : AlertTriangle;
  const colors = isFailed || isError
    ? 'border-red-200 bg-red-50 text-red-900'
    : isStale
      ? 'border-slate-200 bg-slate-50 text-slate-800'
      : 'border-amber-200 bg-amber-50 text-amber-900';

  return (
    <section className={`mb-6 rounded-3xl border px-5 py-4 shadow-[0_12px_30px_rgba(25,25,25,0.06)] ${colors}`} aria-label="수집 상태 안내">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{status.message}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-80">
            <span>{isStale ? '영향 기관 확인 불가' : isError ? '상태 조회 실패' : `${status.affectedCount}개 기관 영향`}</span>
            {status.finishedAt && (
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />마지막 확인 {formatKstTimestamp(status.finishedAt)}</span>
            )}
          </div>
          {status.affectedSources.length > 0 && (
            <>
              <button type="button" aria-expanded={expanded} aria-controls="collection-status-sources" onClick={() => setExpanded(value => !value)} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold underline underline-offset-2">
                영향 기관 {expanded ? '접기' : '보기'} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
              </button>
              {expanded && (
                <ul id="collection-status-sources" className="mt-2 space-y-1 text-xs" aria-label="영향 기관 목록">
                  {status.affectedSources.map(source => <li key={source.name} className="flex justify-between gap-4"><span>{source.name}</span><span className="font-semibold">{userSourceStatusLabel[source.status]}</span></li>)}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
