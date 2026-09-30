import { getCollectionServiceErrorStatus, getCollectionServiceStatus } from '@/lib/collectionStatus';
import { createAdminSupabaseClient } from '@/lib/adminSupabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const noStoreHeaders = { 'Cache-Control': 'no-store' };

const unavailableResponse = () => Response.json(getCollectionServiceErrorStatus(), {
  status: 503,
  headers: noStoreHeaders,
});

export async function GET() {
  try {
    const supabase = createAdminSupabaseClient();
    const { data, error } = await supabase.from('collector_runs')
      .select('finished_at,result,source_health')
      .order('finished_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) return unavailableResponse();

    return Response.json(getCollectionServiceStatus(data), { status: 200, headers: noStoreHeaders });
  } catch {
    return unavailableResponse();
  }
}
