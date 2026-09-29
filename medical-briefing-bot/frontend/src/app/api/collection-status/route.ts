import { getCollectionServiceStatus } from '@/lib/collectionStatus';
import { createAdminSupabaseClient } from '@/lib/adminSupabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cacheHeaders = { 'Cache-Control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=300' };

export async function GET() {
  try {
    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase.from('collector_runs')
      .select('finished_at,result,source_health')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    return Response.json(getCollectionServiceStatus(error ? null : data), {
      status: 200,
      headers: cacheHeaders,
    });
  } catch {
    return Response.json(getCollectionServiceStatus(null), {
      status: 200,
      headers: cacheHeaders,
    });
  }
}
