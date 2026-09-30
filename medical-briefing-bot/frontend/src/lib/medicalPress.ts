export const MEDICAL_PRESS_SOURCES = [
  '청년의사',
  '의협신문',
  '메디게이트뉴스',
  '데일리메디',
  '의학신문',
  '보건신문',
] as const;

export type MedicalPressRange = 'latest' | 'last-seven-days';

export const MEDICAL_PRESS_PAGE_SIZE = 10;

type PressArticle = {
  source: string;
  title: string;
  url: string;
  published_date: string;
  status?: string;
  category?: string;
  keywords?: string;
};

function kstCalendarDateParts(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  return {
    year: Number(parts.find(part => part.type === 'year')?.value),
    month: Number(parts.find(part => part.type === 'month')?.value),
    day: Number(parts.find(part => part.type === 'day')?.value),
  };
}

function formatKstDate({ year, month, day }: { year: number; month: number; day: number }): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function getLastSevenCalendarDaysStartIso(now: Date = new Date()): string {
  const { year, month, day } = kstCalendarDateParts(now);
  const firstIncludedDay = new Date(Date.UTC(year, month - 1, day));
  firstIncludedDay.setUTCDate(firstIncludedDay.getUTCDate() - 6);

  const date = formatKstDate({
    year: firstIncludedDay.getUTCFullYear(),
    month: firstIncludedDay.getUTCMonth() + 1,
    day: firstIncludedDay.getUTCDate(),
  });

  return new Date(`${date}T00:00:00+09:00`).toISOString();
}

export function formatMedicalPressDateKst(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

export function filterBySelectedSources<T extends { source: string }>(
  articles: readonly T[],
  selectedSources: readonly string[],
): T[] {
  const selected = new Set(selectedSources);
  return articles.filter(article => selected.has(article.source));
}

export function filterMedicalPressArticles<T extends PressArticle>(
  articles: readonly T[],
  range: MedicalPressRange,
  searchTerm = '',
  now: Date = new Date(),
): T[] {
  const includedSources = new Set<string>(MEDICAL_PRESS_SOURCES);
  const startAt = range === 'last-seven-days' ? Date.parse(getLastSevenCalendarDaysStartIso(now)) : Number.NEGATIVE_INFINITY;
  const nowAt = now.getTime();
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase('ko-KR');
  const uniqueByUrl = new Map<string, T>();

  for (const article of articles) {
    if (!includedSources.has(article.source) || article.status === 'DELETED' || !article.url) continue;

    const publishedAt = Date.parse(article.published_date);
    if (!Number.isFinite(publishedAt) || publishedAt < startAt || publishedAt > nowAt) continue;

    if (normalizedSearch) {
      const searchableText = `${article.source} ${article.title} ${article.category ?? ''} ${article.keywords ?? ''}`
        .toLocaleLowerCase('ko-KR');
      if (!searchableText.includes(normalizedSearch)) continue;
    }

    const existing = uniqueByUrl.get(article.url);
    if (!existing || Date.parse(existing.published_date) < publishedAt) {
      uniqueByUrl.set(article.url, article);
    }
  }

  return Array.from(uniqueByUrl.values()).sort(
    (left, right) => Date.parse(right.published_date) - Date.parse(left.published_date),
  );
}
