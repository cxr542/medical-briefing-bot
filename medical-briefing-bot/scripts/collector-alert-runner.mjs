import { evaluateCollectorAlerts } from '../frontend/src/lib/collectorAlertEngine.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;
const dryRun = process.argv.includes('--dry-run');
const HISTORY_LIMIT = 60;
const RECOVERY_RUN_MARKER = 'recovery_slot=';

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

const getRecoverySlot = health => {
  if (health.state !== 'STALE' || health.collectorResult === 'FAILED' || !health.nextCollectionDueAt) {
    return null;
  }
  const timestamp = Date.parse(health.nextCollectionDueAt);
  if (!Number.isFinite(timestamp)) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:00+09:00`;
};

const githubRequest = async (path, options = {}) => {
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY || !/^[\w.-]+\/[\w.-]+$/.test(GITHUB_REPOSITORY)) {
    throw new Error('GitHub recovery API is not configured.');
  }
  const response = await fetch(`https://api.github.com/repos/${GITHUB_REPOSITORY}${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      'X-GitHub-Api-Version': '2026-03-10',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(15000),
  });
  if (response.status === 204) return { ok: response.ok, status: response.status, body: null };
  const body = response.ok ? await response.json() : null;
  return { ok: response.ok, status: response.status, body };
};

const getCollectorWorkflowRuns = async () => {
  const result = await githubRequest(
    '/actions/workflows/daily_collector.yml/runs?branch=main&per_page=100',
  );
  if (!result.ok || !Array.isArray(result.body?.workflow_runs)) {
    throw new Error(`GitHub workflow run query failed with HTTP ${result.status}.`);
  }
  return result.body.workflow_runs;
};

const persistState = async state => request(restUrl('collector_alert_state', { on_conflict: 'singleton_id' }), {
  method: 'POST',
  headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
  body: JSON.stringify({ singleton_id: true, state, updated_at: new Date().toISOString() }),
});

const evaluateRecovery = async (health, runs, previousAttempt, now) => {
  const reconcileAttempt = async attempt => {
    const slotTime = Date.parse(attempt.recovery_slot);
    const latestAfterSlot = Array.isArray(runs)
      ? [...runs]
        .filter(run => Date.parse(run.finished_at) > slotTime)
        .sort((left, right) => Date.parse(right.finished_at) - Date.parse(left.finished_at))[0]
      : null;
    if (latestAfterSlot?.result === 'SUCCESS') return { ...attempt, recovery_status: 'RECOVERED' };
    if (['FAILED', 'DEGRADED'].includes(latestAfterSlot?.result)) return { ...attempt, recovery_status: 'FAILED' };
    if (attempt.recovery_status === 'DISPATCHING' || attempt.recovery_status === 'RECOVERY_TRIGGERED') {
      const workflowRuns = await getCollectorWorkflowRuns();
      const recoveryRun = workflowRuns.find(run => (
        (attempt.recovery_run_id && run.id === attempt.recovery_run_id)
        || (typeof run.display_title === 'string'
          && run.display_title.includes(`${RECOVERY_RUN_MARKER}${attempt.recovery_slot}`))
      ));
      if (recoveryRun?.status === 'completed' && recoveryRun.conclusion === 'failure') {
        return { ...attempt, recovery_status: 'FAILED' };
      }
    }
    return attempt;
  };

  if (previousAttempt && ['DISPATCHING', 'RECOVERY_TRIGGERED'].includes(previousAttempt.recovery_status)) {
    const attempt = await reconcileAttempt(previousAttempt);
    return { attempt, dispatch: false, changed: attempt !== previousAttempt };
  }

  const slot = getRecoverySlot(health);
  if (!slot) return { attempt: previousAttempt, dispatch: false, changed: false };
  const slotTime = Date.parse(slot);
  if (previousAttempt?.recovery_slot === slot) {
    return { attempt: previousAttempt, dispatch: false, changed: false };
  }

  if (runs.some(run => Date.parse(run.finished_at) > slotTime && run.result === 'SUCCESS')) {
    return { attempt: previousAttempt, dispatch: false, changed: false };
  }

  const workflowRuns = await getCollectorWorkflowRuns();
  if (workflowRuns.some(run => ['queued', 'in_progress'].includes(run.status))) {
    return { attempt: previousAttempt, dispatch: false, changed: false };
  }

  const attemptedAt = new Date(now).toISOString();
  const attempt = {
    recovery_slot: slot,
    recovery_attempted_at: attemptedAt,
    recovery_status: 'DISPATCHING',
  };
  return { attempt, dispatch: true, changed: true };
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
const previousRecovery = current?.state?.recovery || null;
let state = { ...result.state, ...(previousRecovery ? { recovery: previousRecovery } : {}) };

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
} else {
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
}

if (dryRun) {
  console.log('ALERT_ENGINE_DRY_RUN: state was not written and recovery was not dispatched.');
  process.exit(0);
}

const recoveryDecision = await evaluateRecovery(result.health, runs, previousRecovery, Date.now());
if (recoveryDecision.changed) {
  state = { ...state, ...(recoveryDecision.attempt ? { recovery: recoveryDecision.attempt } : {}) };
}

if (result.events.length > 0 || recoveryDecision.changed) {
  await persistState(state);
  console.log(`ALERT_ENGINE_PERSISTED: transitions=${result.events.length} active=${Object.keys(state.activeIncidents).length}`);
}

if (recoveryDecision.dispatch && recoveryDecision.attempt) {
  try {
    const response = await githubRequest('/actions/workflows/daily_collector.yml/dispatches', {
      method: 'POST',
      body: JSON.stringify({
        ref: 'main',
        inputs: { recovery_slot: recoveryDecision.attempt.recovery_slot },
      }),
    });
    const recoveryStatus = response.ok ? 'RECOVERY_TRIGGERED' : 'FAILED';
    state = {
      ...state,
      recovery: {
        ...recoveryDecision.attempt,
        recovery_status: recoveryStatus,
        ...(response.body?.workflow_run_id ? { recovery_run_id: response.body.workflow_run_id } : {}),
      },
    };
    await persistState(state);
    console.log(`COLLECTOR_RECOVERY slot=${recoveryDecision.attempt.recovery_slot} status=${recoveryStatus} http=${response.status}`);
  } catch {
    console.log(`COLLECTOR_RECOVERY slot=${recoveryDecision.attempt.recovery_slot} status=DISPATCHING outcome=AMBIGUOUS no_retry=true`);
  }
}
