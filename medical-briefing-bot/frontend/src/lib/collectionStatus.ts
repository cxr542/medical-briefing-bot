import {
  COLLECTION_STALE_GRACE_MS,
  isCollectorRunStale,
} from './collectorHealthEngine.mjs';
import {
  COLLECTION_DISPLAY_SCHEDULE_KST,
  getCollectionCutoffIso,
  getKstDateKey,
  getLatestCollectionDisplayTime,
  getLatestCollectionRuntimeTime,
  getNextCollectionRuntimeTime,
  shiftKstDate,
} from './collectionSchedule.mjs';

export {
  COLLECTION_DISPLAY_SCHEDULE_KST,
  getCollectionCutoffIso,
  getKstDateKey,
  getLatestCollectionRuntimeTime,
  shiftKstDate,
};
export { COLLECTION_RUNTIME_SCHEDULE_KST } from './collectorHealthEngine.mjs';
export const COLLECTION_STATUS_STALE_GRACE_MS = COLLECTION_STALE_GRACE_MS;

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
  state: 'NORMAL' | 'DEGRADED' | 'FAILED' | 'STALE' | 'ERROR';
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
  if (value == null) {
    return {
      state: 'STALE',
      message: '아직 수집 기록이 없습니다.',
      affectedSources: [],
      affectedCount: 0,
      finishedAt: null,
      stale: true,
      showBanner: true,
    };
  }

  const run = parseCollectorRun(value);
  if (!run) {
    return getCollectionServiceErrorStatus();
  }

  const stale = isCollectorRunStale(run.finished_at, now);
  const failedSources = Object.entries(run.source_health || {})
    .filter(([, health]) => health.status !== 'OK')
    .map(([name, health]) => ({ name, status: getUserSourceStatus(health) }));

  if (stale) {
    return {
      state: 'STALE',
      message: '최근 수집 이후 다음 예정 실행 시간이 지났습니다.',
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

export function getCollectionServiceErrorStatus(): CollectionServiceStatus {
  return {
    state: 'ERROR',
    message: '현재 최신 수집 상태를 확인할 수 없습니다.',
    affectedSources: [],
    affectedCount: 0,
    finishedAt: null,
    stale: false,
    showBanner: true,
  };
}

export const userSourceStatusLabel = {
  DELAYED: '수집 지연',
  EXTERNAL_ERROR: '외부 서비스 오류',
  INVALID_RESPONSE: '잘못된 응답 차단',
} as const;

export const getLatestCollectionTime = getLatestCollectionDisplayTime;
export const getNextCollectionTime = getNextCollectionRuntimeTime;
