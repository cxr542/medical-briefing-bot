import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { resolveSourceLink } from '../lib/sourceLinks';
import type { SourceArticle } from '../lib/sourceLinks';

type SourceLinkProps = {
  readonly article: SourceArticle;
  readonly className?: string;
  readonly children?: ReactNode;
};

export function SourceLink({ article, className, children }: SourceLinkProps) {
  const link = resolveSourceLink(article);
  switch (link.kind) {
    case 'direct':
    case 'unverified':
      return (
        <a href={link.href} target="_blank" rel="noopener noreferrer" className={className}
          title={link.label} aria-label={`${link.label}: ${article.source} · ${article.title}`}>
          {children ?? <><ExternalLink className="h-4 w-4" /><span className="sr-only">{link.label}</span></>}
          {link.kind === 'unverified' && <span className="block whitespace-normal text-xs">{link.label}</span>}
        </a>
      );
    case 'institution':
      return (
        <details className="max-w-sm whitespace-normal break-keep text-left text-sm text-gray-700 [td_&]:min-w-64">
          <summary className="min-h-11 cursor-pointer rounded px-2 py-2 text-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
            {children}
            <span className="block text-sm font-semibold">{link.label}</span>
          </summary>
          <div className="space-y-2 rounded-lg bg-blue-50 p-3">
            <p className="font-semibold">{link.institution} · {link.board}</p>
            <p className="break-words font-medium">{article.title}</p>
            <p>현재 링크로는 해당 공지의 상세 화면을 바로 열 수 없습니다.</p>
            <p>{link.steps}</p>
            <a href={link.href} target="_blank" rel="noopener noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded px-2 py-2 font-semibold text-blue-700 underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600">
              {link.institution} 열기 <ExternalLink className="h-4 w-4 shrink-0" />
              <span className="sr-only">새 탭</span>
            </a>
          </div>
        </details>
      );
    case 'unavailable':
      return <span className="whitespace-normal text-sm text-gray-500">{link.label}</span>;
    default: {
      const exhaustive: never = link;
      return exhaustive;
    }
  }
}
