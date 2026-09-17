export const COLLECTION_STATUS_STALE_MS = 12 * 60 * 60 * 1000;

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
  if (reason.includes('invalid') || reason.includes('rss')) return 'INVALID_RESPONSE';
  if (reason.includes('http') || reason.includes('api')) return 'EXTERNAL_ERROR';
  return 'DELAYED';
};

export function getCollectionServiceStatus(
  run: CollectorRun | null | undefined,
  now = Date.now(),
): CollectionServiceStatus {
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
    .filter(([, health]) => health.status === 'FAILED')
    .map(([name, health]) => ({ name, status: getUserSourceStatus(health) }));

  if (stale) {
    return {
      state: 'STALE',
      message: '현재 최신 수집 상태를 확인할 수 없습니다.',
      affectedSources: failedSources,
      affectedCount: failedSources.length,
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
