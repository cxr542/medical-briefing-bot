'use client';

import { useId, useRef, type ReactNode } from 'react';
import { ExternalLink, Info, X } from 'lucide-react';
import { resolveSourceLink } from '../lib/sourceLinks';
import type { SourceArticle } from '../lib/sourceLinks';

type SourceLinkProps = {
  readonly article: SourceArticle;
  readonly className?: string;
  readonly children?: ReactNode;
  readonly variant?: 'content' | 'icon';
};

const iconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 p-2 text-blue-700 shadow-sm transition-colors hover:bg-blue-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2';

export function SourceLink({ article, className, children, variant = 'content' }: SourceLinkProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const headingId = useId();
  const descriptionId = useId();
  const link = resolveSourceLink(article);
  switch (link.kind) {
    case 'direct':
    case 'unverified':
      return (
        <a href={link.href} target="_blank" rel="noopener noreferrer" className={variant === 'icon' ? iconButton : className}
          title={link.label} aria-label={`${link.label}: ${article.source} · ${article.title}`}>
          {variant === 'icon' ? (link.kind === 'direct' ? <ExternalLink aria-hidden="true" className="h-4 w-4" /> : <Info aria-hidden="true" className="h-4 w-4" />) : children ?? <ExternalLink aria-hidden="true" className="h-4 w-4" />}
          {link.kind === 'unverified' && variant !== 'icon' && <span className="block whitespace-normal text-xs">{link.label}</span>}
        </a>
      );
    case 'institution':
      return (
        <>
          <button type="button" onClick={() => dialog.current?.showModal()}
            className={variant === 'icon' ? iconButton : `${className ?? ''} min-h-11 rounded text-left text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600`}
            aria-haspopup="dialog" aria-label={`${link.label}: ${article.source} · ${article.title}`} title={link.label}>
            {variant === 'icon' ? <Info aria-hidden="true" className="h-4 w-4" /> : <>{children}<span className="block text-xs font-semibold">{link.label}</span></>}
          </button>
          <dialog ref={dialog} aria-labelledby={headingId} aria-describedby={descriptionId}
            onClick={(event) => { if (event.target === event.currentTarget) dialog.current?.close(); }}
            className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border border-blue-100 bg-white p-0 text-left text-sm text-gray-700 shadow-xl backdrop:bg-black/40">
            <div className="space-y-3 whitespace-normal break-keep p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 id={headingId} className="text-base font-bold text-gray-900">기관에서 공지 찾기</h2>
                <button type="button" autoFocus onClick={() => dialog.current?.close()} aria-label="기관 안내 닫기"
                  className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                  <X aria-hidden="true" className="h-5 w-5" />
                </button>
              </div>
              <p className="font-semibold">{link.institution} · {link.board}</p>
              <p className="break-words font-medium">{article.title}</p>
              <p id={descriptionId}>직접 상세 링크가 확인되지 않았습니다. 기관 홈페이지에서 표시된 공지 제목을 찾아 주세요.</p>
              <p>{link.steps}</p>
              <a href={link.href} target="_blank" rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-2 rounded px-2 py-2 font-semibold text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
                기관 홈페이지 열기 <ExternalLink aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="sr-only">새 탭</span>
              </a>
            </div>
          </dialog>
        </>
      );
    case 'unavailable':
      return <span className="whitespace-normal text-sm text-gray-500">{link.label}</span>;
    default: {
      const exhaustive: never = link;
      return exhaustive;
    }
  }
}
