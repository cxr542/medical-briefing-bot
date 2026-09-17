'use client';

import { useState } from 'react';
import { AlertTriangle, ChevronDown, Clock, XCircle } from 'lucide-react';
import { CollectionServiceStatus, userSourceStatusLabel } from '@/lib/collectionStatus';

export default function CollectionStatusBanner({ status }: { status: CollectionServiceStatus }) {
  const [expanded, setExpanded] = useState(false);

  if (!status.showBanner) return null;

  const isStale = status.state === 'STALE';
  const isFailed = status.state === 'FAILED';
  const Icon = isFailed ? XCircle : AlertTriangle;
  const colors = isFailed
    ? 'border-red-200 bg-red-50 text-red-900'
    : isStale
      ? 'border-slate-200 bg-slate-50 text-slate-800'
      : 'border-amber-200 bg-amber-50 text-amber-900';

  return (
    <section className={`mb-6 rounded-xl border px-4 py-3 shadow-sm ${colors}`} aria-label="수집 상태 안내">
      <div className="flex items-start gap-3">
        <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{status.message}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs opacity-80">
            {!isStale && <span>{status.affectedCount}개 기관 영향</span>}
            {status.finishedAt && (
              <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" aria-hidden="true" />마지막 확인 {new Date(status.finishedAt).toLocaleString('ko-KR')}</span>
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
