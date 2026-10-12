import { getCollectionCutoffIso, getKstDateKey, shiftKstDate } from './collectionSchedule.mjs';

type ArticleState = {
  status: string;
  created_at?: string | null;
};

// Date-only values are calendar dates. Zone-less timestamps are interpreted as KST,
// never as the browser's local timezone.
export function articleDateTimestamp(value: string | Date | number | null | undefined): number {
  if (value == null) return Number.NaN;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const normalized = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return Date.parse(`${normalized}T00:00:00+09:00`);
  }
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(normalized)) {
    return Date.parse(`${normalized.replace(' ', 'T')}+09:00`);
  }
  return Date.parse(normalized);
}

export function formatDateKst(value: string | Date | number | null | undefined): string {
  const timestamp = articleDateTimestamp(value);
  return Number.isFinite(timestamp) ? getKstDateKey(timestamp) : '—';
}

export function isNewForBriefingDate(article: ArticleState, selectedDate: string): boolean {
  // Production has no first_seen_at. Current writers omit created_at on inserts
  // and updates, so its DB default records the first INSERT for the stored URL.
  // Missing timestamps must not fall back to published_date or imply NEW.
  return article.status === 'NEW'
    && !!article.created_at
    && formatDateKst(article.created_at) === selectedDate;
}

export function getDisplayedArticleStatus(article: ArticleState, selectedDate: string): string {
  if (article.status !== 'NEW') return article.status;
  return isNewForBriefingDate(article, selectedDate) ? 'NEW' : '유지';
}

export function getRecentNotices<T extends { published_date: string }>(
  articles: readonly T[],
  selectedDate: string,
  selectedTime: string,
): T[] {
  // Seven KST calendar days, including the selected day, up to its briefing slot.
  const start = articleDateTimestamp(shiftKstDate(selectedDate, -6));
  const end = Date.parse(getCollectionCutoffIso(selectedDate, selectedTime));
  return articles.filter(article => {
    const publishedAt = articleDateTimestamp(article.published_date);
    return publishedAt >= start && publishedAt <= end;
  });
}
