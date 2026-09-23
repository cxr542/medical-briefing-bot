export const COLLECTION_STATUS_STALE_MS = 12 * 60 * 60 * 1000;
export const COLLECTION_RUNTIME_SCHEDULE_KST = ['06:07', '08:30', '12:07', '15:07'] as const;
export const COLLECTION_DISPLAY_SCHEDULE_KST = ['06:00', '08:30', '12:00', '15:00'] as const;

export type SourceHealth = Record<string, {
  count: number;
  status: 'OK' | 'WARN' | 'FAILED';
  reason: string;
}>;

export type CollectorRun = {
  started_at: string;
  finished_at: string;
  result: 'SUCCESS' | 'DEGRADED' | 'FAILED';
  collected_count: number;
  ai_output_count: number;
  db_attempted: number;
  db_succeeded: number;
  db_failed: number;
  source_health: SourceHealth;
};

export type CollectionServiceStatus = {
  state: 'NORMAL' | 'DEGRADED' | 'FAILED' | 'STALE';
  message: string;
  affectedSources: Array<{ name: string; status: 'DELAYED' | 'EXTERNAL_ERROR' | 'INVALID_RESPONSE' }>;
  affectedCount: number;
  finishedAt: string | null;
  stale: boolean;
  showBanner: boolean;
};

const getUserSourceStatus = (health: SourceHealth[string]): CollectionServiceStatus['affectedSources'][number]['status'] => {
  const reason = String(health.reason || '').toLowerCase();
  if (reason.includes('invalid') || reason.includes('unsupportable')) return 'INVALID_RESPONSE';
  if (reason.includes('http') || reason.includes('api')) return 'EXTERNAL_ERROR';
  return 'DELAYED';
};

const isSourceHealth = (value: unknown): value is SourceHealth[string] => {
  if (!value || typeof value !== 'object') return false;
  const health = value as Partial<SourceHealth[string]>;
  return typeof health.count === 'number'
    && (health.status === 'OK' || health.status === 'WARN' || health.status === 'FAILED');
};

const parseCollectorRun = (value: unknown): CollectorRun | null => {
  if (!value || typeof value !== 'object') return null;
  const run = value as Partial<CollectorRun>;
  if (run.result !== 'SUCCESS' && run.result !== 'DEGRADED' && run.result !== 'FAILED') return null;
  if (typeof run.finished_at !== 'string' || !run.source_health || typeof run.source_health !== 'object') return null;
  const sourceHealth = Object.fromEntries(
    Object.entries(run.source_health).filter(([, health]) => isSourceHealth(health)),
  ) as SourceHealth;
  return { ...run, source_health: sourceHealth } as CollectorRun;
};

export function getCollectionServiceStatus(
  value: unknown,
  now = Date.now(),
): CollectionServiceStatus {
  const run = parseCollectorRun(value);
  if (!run) {
    return {
      state: 'STALE',
      message: '현재 최신 수집 상태를 확인할 수 없습니다.',
      affectedSources: [],
      affectedCount: 0,
      finishedAt: null,
      stale: true,
      showBanner: true,
    };
  }

  const finishedAtMs = new Date(run.finished_at).getTime();
  const stale = Number.isNaN(finishedAtMs) || now - finishedAtMs > COLLECTION_STATUS_STALE_MS;
  const failedSources = Object.entries(run.source_health || {})
    .filter(([, health]) => health.status !== 'OK')
    .map(([name, health]) => ({ name, status: getUserSourceStatus(health) }));

  if (stale) {
    return {
      state: 'STALE',
      message: '현재 최신 수집 상태를 확인할 수 없습니다.',
      affectedSources: [],
      affectedCount: 0,
      finishedAt: run.finished_at,
      stale: true,
      showBanner: true,
    };
  }

  if (run.result === 'FAILED') {
    return {
      state: 'FAILED',
      message: '최신 정보 수집에 문제가 발생했습니다.',
      affectedSources: failedSources,
      affectedCount: failedSources.length,
      finishedAt: run.finished_at,
      stale: false,
      showBanner: true,
    };
  }

  if (failedSources.length > 0 || run.result === 'DEGRADED') {
    return {
      state: 'DEGRADED',
      message: '일부 기관의 최신 정보 수집이 지연되고 있습니다.',
      affectedSources: failedSources,
      affectedCount: failedSources.length,
      finishedAt: run.finished_at,
      stale: false,
      showBanner: true,
    };
  }

  return {
    state: 'NORMAL',
    message: '정상',
    affectedSources: [],
    affectedCount: 0,
    finishedAt: run.finished_at,
    stale: false,
    showBanner: false,
  };
}

export const userSourceStatusLabel = {
  DELAYED: '수집 지연',
  EXTERNAL_ERROR: '외부 서비스 오류',
  INVALID_RESPONSE: '잘못된 응답 차단',
} as const;

const toKstMinutes = (now: Date): number => {
  const kst = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
  return kst.getHours() * 60 + kst.getMinutes();
};

export const isBeforeFirstCollectionTime = (now = new Date()): boolean => {
  const [hours, minutes] = COLLECTION_RUNTIME_SCHEDULE_KST[0].split(':').map(Number);
  return toKstMinutes(now) < hours * 60 + minutes;
};

export const getLatestCollectionTime = (now = new Date()): (typeof COLLECTION_RUNTIME_SCHEDULE_KST)[number] => {
  const currentMinutes = toKstMinutes(now);
  const latest = [...COLLECTION_RUNTIME_SCHEDULE_KST].reverse().find(time => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes <= currentMinutes;
  });
  return latest || COLLECTION_RUNTIME_SCHEDULE_KST[COLLECTION_RUNTIME_SCHEDULE_KST.length - 1];
};

export const getNextCollectionTime = (now = new Date()): (typeof COLLECTION_RUNTIME_SCHEDULE_KST)[number] => {
  const currentMinutes = toKstMinutes(now);
  const next = COLLECTION_RUNTIME_SCHEDULE_KST.find(time => {
    const [hours, minutes] = time.split(':').map(Number);
    return hours * 60 + minutes > currentMinutes;
  });
  return next || COLLECTION_RUNTIME_SCHEDULE_KST[0];
};
