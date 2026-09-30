import { COLLECTION_RUNTIME_SCHEDULE_KST } from './collectionSchedule.mjs';

export { COLLECTION_RUNTIME_SCHEDULE_KST } from './collectionSchedule.mjs';

export const COLLECTION_STALE_GRACE_MS = 2 * 60 * 60 * 1000;
export const COLLECTION_HEALTH_HISTORY_LIMIT = 60;

const MAX_RECENT_STATUSES = 5;
const VALID_SOURCE_STATUSES = new Set(['OK', 'WARN', 'FAILED']);
const VALID_COLLECTOR_RESULTS = new Set(['SUCCESS', 'DEGRADED', 'FAILED']);

const asRecord = value => (
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : null
);

const isSourceHealth = value => {
  const health = asRecord(value);
  return health !== null
    && typeof health.count === 'number'
    && Number.isFinite(health.count)
    && VALID_SOURCE_STATUSES.has(health.status);
};

const parseRun = value => {
  const run = asRecord(value);
  if (run === null
    || typeof run.finished_at !== 'string'
    || !Number.isFinite(Date.parse(run.finished_at))
    || !VALID_COLLECTOR_RESULTS.has(run.result)
    || asRecord(run.source_health) === null) {
    return null;
  }

  const sourceHealth = Object.fromEntries(
    Object.entries(run.source_health).filter(([, health]) => isSourceHealth(health)),
  );
  return { ...run, source_health: sourceHealth };
};

const getKstDateParts = timestamp => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
};

const toKstDateTime = (year, month, day, time) => {
  const [hours, minutes] = time.split(':').map(Number);
  return Date.UTC(year, month - 1, day, hours - 9, minutes);
};

export function getNextCollectionDueAt(finishedAt) {
  const finishedAtMs = Date.parse(finishedAt);
  if (!Number.isFinite(finishedAtMs)) return null;

  const kst = getKstDateParts(finishedAtMs);
  const year = Number(kst.year);
  const month = Number(kst.month);
  const day = Number(kst.day);
  const candidates = [];

  for (let offset = 0; offset <= 1; offset += 1) {
    const candidateDate = new Date(Date.UTC(year, month - 1, day + offset));
    const candidateYear = candidateDate.getUTCFullYear();
    const candidateMonth = candidateDate.getUTCMonth() + 1;
    const candidateDay = candidateDate.getUTCDate();
    for (const time of COLLECTION_RUNTIME_SCHEDULE_KST) {
      const candidate = toKstDateTime(candidateYear, candidateMonth, candidateDay, time);
      if (candidate > finishedAtMs) candidates.push(candidate);
    }
  }

  const nextDueAt = candidates.sort((left, right) => left - right)[0];
  return Number.isFinite(nextDueAt) ? new Date(nextDueAt).toISOString() : null;
}

export function isCollectorRunStale(finishedAt, now = Date.now()) {
  const nextDueAt = finishedAt ? getNextCollectionDueAt(finishedAt) : null;
  return nextDueAt === null || now > Date.parse(nextDueAt) + COLLECTION_STALE_GRACE_MS;
}

export function sanitizeOperationalReason(reason) {
  if (typeof reason !== 'string' || reason.trim() === '') return '';

  return reason
    .replace(/https?:\/\/[^\s"'<>]+/gi, url => {
      try {
        const parsed = new URL(url);
        return `${parsed.origin}${parsed.pathname}`;
      } catch {
        return '[URL 생략]';
      }
    })
    .replace(/\b(supabase[-_ ]?key|law[-_ ]?api[-_ ]?key|api[-_ ]?key|token|secret|password|oc)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/\b(authorization|cookie)\s*[:=]\s*[^\r\n]*/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

const statusLabel = status => {
  if (status === 'FAILED') return 'FAILED';
  if (status === 'WARN') return 'DEGRADED';
  return 'NORMAL';
};

const sortSources = sources => {
  const rank = { STALE: 0, FAILED: 1, DEGRADED: 2, NORMAL: 3 };
  return sources.sort((left, right) => (
    rank[left.state] - rank[right.state]
      || right.consecutiveFailures - left.consecutiveFailures
      || left.name.localeCompare(right.name, 'ko')
  ));
};

export function getCollectorHealth(values, now = Date.now()) {
  const runs = (Array.isArray(values) ? values : [])
    .map(parseRun)
    .filter(Boolean)
    .sort((left, right) => Date.parse(right.finished_at) - Date.parse(left.finished_at));
  const latestRun = runs[0] || null;

  if (latestRun === null) {
    return {
      state: 'STALE',
      collectorResult: null,
      latestRunAt: null,
      nextCollectionDueAt: null,
      staleAt: null,
      stale: true,
      consecutiveDegradedRuns: 0,
      sources: [],
    };
  }

  const latestRunAt = latestRun.finished_at;
  const nextCollectionDueAt = getNextCollectionDueAt(latestRunAt);
  const staleAt = nextCollectionDueAt
    ? new Date(Date.parse(nextCollectionDueAt) + COLLECTION_STALE_GRACE_MS).toISOString()
    : null;
  const stale = isCollectorRunStale(latestRunAt, now);
  let consecutiveDegradedRuns = 0;
  for (const run of runs) {
    if (run.result !== 'DEGRADED') break;
    consecutiveDegradedRuns += 1;
  }
  const sourceNames = Object.keys(latestRun.source_health);
  const sources = sourceNames.map(name => {
    const history = runs.flatMap(run => {
      const health = run.source_health[name];
      return isSourceHealth(health) ? [{ run, health }] : [];
    });
    const latest = history[0];
    if (!latest) return null;

    let consecutiveFailures = 0;
    for (const entry of history) {
      if (entry.health.status !== 'FAILED') break;
      consecutiveFailures += 1;
    }

    let hasFailureSinceRecovery = false;
    let lastRecoveryAt = null;
    for (const entry of [...history].reverse()) {
      if (entry.health.status === 'FAILED') {
        hasFailureSinceRecovery = true;
      } else if (entry.health.status === 'OK' && hasFailureSinceRecovery) {
        lastRecoveryAt = entry.run.finished_at;
        hasFailureSinceRecovery = false;
      }
    }

    const state = stale ? 'STALE' : statusLabel(latest.health.status);
    const latestFailure = history.find(entry => entry.health.status === 'FAILED');
    const latestSuccess = history.find(entry => entry.health.status === 'OK');

    return {
      name,
      state,
      currentStatus: latest.health.status,
      count: latest.health.count,
      reason: sanitizeOperationalReason(latest.health.reason),
      lastSuccessAt: latestSuccess?.run.finished_at || null,
      consecutiveFailures,
      latestFailureReason: latestFailure
        ? sanitizeOperationalReason(latestFailure.health.reason) || '수집 실패'
        : null,
      latestAttemptAt: latest.run.finished_at,
      lastRecoveryAt,
      recentStatuses: history.slice(0, MAX_RECENT_STATUSES).map(entry => ({
        status: entry.health.status,
        finishedAt: entry.run.finished_at,
      })),
    };
  }).filter(Boolean);

  const hasSourceFailure = Object.values(latestRun.source_health)
    .some(health => health.status === 'FAILED' || health.status === 'WARN');
  const state = stale
    ? 'STALE'
    : latestRun.result === 'FAILED'
      ? 'FAILED'
      : latestRun.result === 'DEGRADED' || hasSourceFailure
        ? 'DEGRADED'
        : 'NORMAL';

  return {
    state,
    collectorResult: latestRun.result,
    latestRunAt,
    nextCollectionDueAt,
    staleAt,
    stale,
    consecutiveDegradedRuns,
    sources: sortSources(sources),
  };
}
