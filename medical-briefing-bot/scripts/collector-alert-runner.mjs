import { evaluateCollectorAlerts } from '../frontend/src/lib/collectorAlertEngine.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const dryRun = process.argv.includes('--dry-run');
const HISTORY_LIMIT = 60;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Collector alert engine requires configured Supabase environment variables.');
  process.exit(1);
}

let baseUrl;
try {
  baseUrl = new URL(SUPABASE_URL);
  if (baseUrl.protocol !== 'https:' || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
    throw new Error('invalid URL shape');
  }
} catch {
  console.error('SUPABASE_URL must be an HTTPS project base URL without a path.');
  process.exit(1);
}

const restUrl = (path, params = {}) => {
  const target = new URL(`/rest/v1/${path}`, baseUrl);
  target.search = new URLSearchParams(params).toString();
  return target;
};

const request = async (url, options = {}) => {
  const response = await fetch(url, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    if (response.status === 404 && url.pathname.endsWith('/collector_alert_state')) {
      return { missingStateTable: true };
    }
    throw new Error(`Supabase REST request failed with HTTP ${response.status}.`);
  }
  if (
    response.status === 204
    || options.headers?.Prefer?.includes('return=minimal')
  ) return null;
  return response.json();
};

const runs = await request(restUrl('collector_runs', {
  select: 'id,finished_at,result,source_health',
  order: 'finished_at.desc',
  limit: String(HISTORY_LIMIT),
}));
const persisted = await request(restUrl('collector_alert_state', {
  select: 'singleton_id,state',
  singleton_id: 'eq.true',
}));

if (persisted?.missingStateTable) {
  console.log('ALERT_ENGINE_MIGRATION_REQUIRED: collector_alert_state is not available; evaluation skipped.');
  process.exit(0);
}

const current = Array.isArray(persisted) ? persisted[0] : null;
const result = evaluateCollectorAlerts(runs, current?.state, Date.now());

if (result.events.length === 0) {
  const affectedSources = result.health.sources.filter(source => source.currentStatus !== 'OK');
  if (affectedSources.length > 0) {
    for (const source of affectedSources) {
      const reason = source.latestFailureReason || source.reason || '수집 상태 확인 필요';
      console.log(
        `ALERT_ENGINE source=${source.name} status=${source.currentStatus} `
        + `consecutive_failures=${source.consecutiveFailures} reason=${reason} alert=NOT_TRIGGERED`,
      );
    }
  } else {
    console.log(
      `ALERT_ENGINE source=Collector status=${result.health.state} `
      + `consecutive_degraded_runs=${result.health.consecutiveDegradedRuns} `
      + `reason=${result.health.collectorResult || 'no valid run'} alert=NOT_TRIGGERED`,
    );
  }
  process.exit(0);
}

for (const event of result.events) {
  const failureCount = event.consecutiveFailures === undefined
    ? ''
    : ` consecutive_failures=${event.consecutiveFailures}`;
  const degradedCount = event.consecutiveDegradedRuns === undefined
    ? ''
    : ` consecutive_degraded_runs=${event.consecutiveDegradedRuns}`;
  console.log(
    `${event.type} source=${event.name} status=${event.status}`
    + `${failureCount}${degradedCount} run=${event.runId ?? 'none'} reason=${event.reason}`
    + ` alert=${event.type === 'RECOVERED' ? 'RECOVERED' : 'TRIGGERED'}`,
  );
}

if (dryRun) {
  console.log('ALERT_ENGINE_DRY_RUN: state was not written.');
  process.exit(0);
}

const payload = {
  singleton_id: true,
  state: result.state,
  updated_at: new Date().toISOString(),
};
await request(restUrl('collector_alert_state', { on_conflict: 'singleton_id' }), {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify(payload),
});
console.log(`ALERT_ENGINE_PERSISTED: transitions=${result.events.length} active=${Object.keys(result.state.activeIncidents).length}`);
