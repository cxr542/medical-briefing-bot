import { getCollectorHealth, sanitizeOperationalReason } from './collectorHealthEngine.mjs';

export const CORE_SOURCE_HEALTH_KEYS = Object.freeze([
  '보건복지부 보도자료',
  '질병관리청 보도자료',
  '식품의약품안전처 보도자료',
  '국가법령정보센터',
  '심평원 e-평가',
  '심평원 e-평가 (평가알림방)',
]);

const coreSourceSet = new Set(CORE_SOURCE_HEALTH_KEYS);
const asObject = value => (
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
);

const getDesiredIncidents = health => {
  if (health.collectorResult === 'FAILED') {
    return [{
      key: 'collector:failed',
      kind: 'FAILED',
      name: 'Collector',
      status: 'FAILED',
      reason: 'Collector 실행 결과가 FAILED입니다.',
    }];
  }
  if (health.stale) {
    return [{
      key: 'collector:stale',
      kind: 'STALE',
      name: 'Collector',
      status: 'STALE',
      reason: '예정된 실행 후 stale grace를 초과했습니다.',
    }];
  }

  const failingCoreSources = health.sources.filter(source => (
    coreSourceSet.has(source.name)
      && source.currentStatus === 'FAILED'
      && source.consecutiveFailures >= 2
  ));
  if (failingCoreSources.length > 0) {
    return failingCoreSources.map(source => ({
      key: `source:${source.name}`,
      kind: 'SOURCE_FAILED',
      name: source.name,
      status: source.currentStatus,
      consecutiveFailures: source.consecutiveFailures,
      reason: source.latestFailureReason || source.reason || '연속 source 실패',
    }));
  }

  if (health.state === 'DEGRADED' && health.consecutiveDegradedRuns >= 2) {
    const sourceNames = health.sources
      .filter(source => source.currentStatus !== 'OK')
      .map(source => source.name);
    return [{
      key: 'collector:degraded',
      kind: 'DEGRADED',
      name: 'Collector',
      status: 'DEGRADED',
      consecutiveDegradedRuns: health.consecutiveDegradedRuns,
      reason: sourceNames.length > 0
        ? `연속 DEGRADED 실행: ${sourceNames.join(', ')}`
        : 'Collector가 연속 DEGRADED 상태입니다.',
    }];
  }
  return [];
};

const shouldRecover = (incident, health) => {
  if (incident.kind === 'STALE') return !health.stale;
  if (incident.kind === 'FAILED') {
    return health.collectorResult !== null && health.collectorResult !== 'FAILED';
  }
  if (incident.kind === 'DEGRADED') return health.state === 'NORMAL';
  const source = health.sources.find(item => item.name === incident.name);
  return incident.kind === 'SOURCE_FAILED' && source?.currentStatus === 'OK';
};

export function evaluateCollectorAlerts(runs, previousState = {}, now = Date.now()) {
  const health = getCollectorHealth(runs, now);
  const previous = asObject(previousState);
  const currentActive = asObject(previous.activeIncidents);
  const activeIncidents = { ...currentActive };
  const events = [];
  const latestRun = Array.isArray(runs)
    ? [...runs].sort((left, right) => Date.parse(right.finished_at) - Date.parse(left.finished_at))[0]
    : null;
  const runId = latestRun?.id ?? null;
  const at = new Date(now).toISOString();

  for (const [key, incident] of Object.entries(currentActive)) {
    if (shouldRecover(incident, health)) {
      events.push({
        type: 'RECOVERED',
        key,
        name: incident.name,
        status: 'RECOVERED',
        at,
        runId,
        reason: '정상 상태로 복구되었습니다.',
      });
      delete activeIncidents[key];
    }
  }

  for (const candidate of getDesiredIncidents(health)) {
    if (activeIncidents[candidate.key]) continue;
    const incident = { ...candidate, openedAt: at, runId };
    activeIncidents[candidate.key] = incident;
    events.push({
      type: 'ALERT',
      key: candidate.key,
      kind: candidate.kind,
      name: candidate.name,
      status: candidate.status,
      consecutiveFailures: candidate.consecutiveFailures,
      consecutiveDegradedRuns: candidate.consecutiveDegradedRuns,
      at,
      runId,
      reason: sanitizeOperationalReason(candidate.reason),
    });
  }

  const priorEvents = Array.isArray(previous.events) ? previous.events : [];
  const nextState = {
    version: 1,
    activeIncidents,
    events: [...priorEvents, ...events].slice(-100),
  };
  const changed = events.length > 0
    || JSON.stringify(currentActive) !== JSON.stringify(activeIncidents);

  return { health, state: nextState, events, changed };
}
