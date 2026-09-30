const scenario = process.env.ALERT_TEST_SCENARIO;

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(
    input instanceof URL ? input.href : typeof input === 'string' ? input : input.url,
  );
  const method = options.method || 'GET';

  if (url.pathname.endsWith('/collector_runs')) {
    if (scenario === 'query-fails') return new Response('unavailable', { status: 503 });

    const run = {
      id: 61,
      finished_at: scenario === 'stale-alert'
        ? new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString()
        : new Date().toISOString(),
      result: scenario === 'degraded' ? 'DEGRADED' : 'SUCCESS',
      source_health: scenario === 'degraded'
        ? { 'Example source': { count: 0, status: 'WARN', reason: 'test reason' } }
        : {},
    };
    return Response.json([run]);
  }

  if (url.pathname.endsWith('/collector_alert_state')) {
    const hasNoActiveIncident = ['normal', 'degraded', 'stale-alert'].includes(scenario);
    if (method === 'POST') {
      return scenario === 'persistence-fails'
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
      },
    }]);
  }

  return new Response('not found', { status: 404 });
};
