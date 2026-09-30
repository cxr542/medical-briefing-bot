const scenario = process.env.ALERT_TEST_SCENARIO;
import { getNextCollectionDueAt } from '../../frontend/src/lib/collectorHealthEngine.mjs';
const staleFinishedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const toKstSlot = timestamp => {
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
const staleSlot = toKstSlot(Date.parse(getNextCollectionDueAt(staleFinishedAt)));

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(
    input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
  );
  const method = options.method || 'GET';

  if (url.hostname === 'api.github.com') {
    if (url.pathname.endsWith('/actions/workflows/daily_collector.yml/runs')) {
      const status = scenario === 'collector-queued'
        ? 'queued'
        : scenario === 'collector-in-progress' ? 'in_progress' : null;
      return Response.json({ workflow_runs: status ? [{ status }] : [] });
    }
    if (url.pathname.endsWith('/actions/workflows/daily_collector.yml/dispatches')) {
      const body = JSON.parse(options.body);
      console.log('TEST_DISPATCH_RECEIVED');
      console.log(`TEST_DISPATCH_REF=${body.ref}`);
      console.log(`TEST_RECOVERY_INPUT=${body.inputs.recovery_slot}`);
      if (scenario === 'dispatch-fails') return new Response('forbidden', { status: 403 });
      if (scenario === 'dispatch-ambiguous') throw new Error('network failed');
      return Response.json({ workflow_run_id: 12345 }, { status: 200 });
    }
  }

  if (url.pathname.endsWith('/collector_runs')) {
    if (scenario === 'query-fails') return new Response('unavailable', { status: 503 });

    const run = {
      id: 61,
      finished_at: ['stale-alert', 'dispatch-stale', 'collector-queued', 'collector-in-progress', 'dispatch-attempted', 'dispatch-attempted-failed', 'dispatch-attempted-ambiguous', 'dispatch-fails', 'dispatch-ambiguous', 'dispatch-persist-fails'].includes(scenario)
        ? staleFinishedAt
        : new Date().toISOString(),
      result: scenario === 'degraded' ? 'DEGRADED' : scenario === 'collector-failed' || scenario === 'recovery-failed' ? 'FAILED' : 'SUCCESS',
      source_health: scenario === 'degraded'
        ? { 'Example source': { count: 0, status: 'WARN', reason: 'test reason' } }
        : {},
    };
    return Response.json([run]);
  }

  if (url.pathname.endsWith('/collector_alert_state')) {
    const hasNoActiveIncident = ['normal', 'degraded', 'stale-alert'].includes(scenario);
    if (method === 'POST') {
      const body = JSON.parse(options.body);
      console.log(`TEST_RECOVERY_STATUS=${body.state.recovery?.recovery_status || 'none'}`);
      if (body.state.recovery?.recovery_run_id) {
        console.log(`TEST_RECOVERY_RUN_ID=${body.state.recovery.recovery_run_id}`);
      }
      return ['persistence-fails', 'dispatch-persist-fails'].includes(scenario)
        ? new Response('unavailable', { status: 503 })
        : new Response(null, { status: scenario === 'persist-success-200' ? 200 : 201 });
    }

    return Response.json([{
      singleton_id: true,
      state: {
        version: 1,
        activeIncidents: hasNoActiveIncident
          ? {}
          : {
              'collector:stale': {
                key: 'collector:stale',
                kind: 'STALE',
                name: 'Collector',
                status: 'STALE',
                openedAt: new Date().toISOString(),
                runId: 60,
              },
        },
        events: [],
        ...(['dispatch-attempted', 'dispatch-attempted-failed', 'dispatch-attempted-ambiguous', 'recovery-success', 'recovery-failed'].includes(scenario)
          ? {
            recovery: {
              recovery_slot: scenario.startsWith('dispatch-attempted') ? staleSlot : toKstSlot(Date.now() - 60 * 60 * 1000),
              recovery_attempted_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
              recovery_status: scenario === 'dispatch-attempted-failed'
                ? 'FAILED'
                : scenario === 'dispatch-attempted-ambiguous' ? 'DISPATCHING' : 'RECOVERY_TRIGGERED',
            },
          }
          : {}),
      },
    }]);
  }

  return new Response('not found', { status: 404 });
};
