import { NextResponse } from 'next/server';
import { COLLECTION_HEALTH_HISTORY_LIMIT } from '@/lib/collectorHealthEngine.mjs';
import { isAdminRequestAuthorized } from '@/lib/adminAuth.mjs';
import { createAdminSupabaseClient } from '@/lib/adminSupabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const json = (body: unknown, status: number) => NextResponse.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store, max-age=0' },
});

export async function GET(request: Request) {
  if (!isAdminRequestAuthorized(request)) return json({ error: 'Unauthorized' }, 401);

  try {
    const supabase = createAdminSupabaseClient();
    const [articleResponse, runResponse] = await Promise.all([
      supabase.from('articles').select('source', { count: 'exact' }).limit(1000),
      supabase.from('collector_runs')
        .select('id,started_at,finished_at,result,collected_count,ai_output_count,db_attempted,db_succeeded,db_failed,source_health')
        .order('finished_at', { ascending: false })
        .limit(COLLECTION_HEALTH_HISTORY_LIMIT),
    ]);

    const counts: Record<string, number> = {};
    for (const article of articleResponse.data || []) {
      if (typeof article.source === 'string') counts[article.source] = (counts[article.source] || 0) + 1;
    }

    const stats = Object.entries(counts)
      .map(([source, count]) => ({ source, count }))
      .sort((left, right) => right.count - left.count);

    return json({
      stats,
      totalCount: articleResponse.count ?? 0,
      statsError: articleResponse.error ? '기사 통계를 조회할 수 없습니다.' : '',
      collectorRuns: runResponse.data || [],
      collectorRunsError: runResponse.error
        ? 'collector_runs 테이블을 조회할 수 없습니다. SQL migration 적용 여부를 확인해주세요.'
        : '',
    }, 200);
  } catch {
    return json({ error: '관리자 모니터링 정보를 불러올 수 없습니다.' }, 503);
  }
}
