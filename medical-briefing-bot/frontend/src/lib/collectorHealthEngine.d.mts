export type CollectorHealthState = 'NORMAL' | 'DEGRADED' | 'FAILED' | 'STALE';

export type SourceCollectionStatus = 'OK' | 'WARN' | 'FAILED';

export type RecentSourceStatus = {
  readonly status: SourceCollectionStatus;
  readonly finishedAt: string;
};

export type CollectorSourceHealth = {
  readonly name: string;
  readonly state: CollectorHealthState;
  readonly currentStatus: SourceCollectionStatus;
  readonly count: number;
  readonly reason: string;
  readonly lastSuccessAt: string | null;
  readonly consecutiveFailures: number;
  readonly latestFailureReason: string | null;
  readonly latestAttemptAt: string;
  readonly lastRecoveryAt: string | null;
  readonly recentStatuses: readonly RecentSourceStatus[];
};

export type CollectorHealth = {
  readonly state: CollectorHealthState;
  readonly collectorResult: 'SUCCESS' | 'DEGRADED' | 'FAILED' | null;
  readonly latestRunAt: string | null;
  readonly nextCollectionDueAt: string | null;
  readonly staleAt: string | null;
  readonly stale: boolean;
  readonly consecutiveDegradedRuns: number;
  readonly sources: readonly CollectorSourceHealth[];
};

export const COLLECTION_RUNTIME_SCHEDULE_KST: readonly ['06:07', '08:30', '12:07', '15:07'];
export const COLLECTION_STALE_GRACE_MS: number;
export const COLLECTION_HEALTH_HISTORY_LIMIT: number;

export function getNextCollectionDueAt(finishedAt: string): string | null;
export function isCollectorRunStale(finishedAt: string | null, now?: number): boolean;
export function getCollectorHealth(values: readonly unknown[], now?: number): CollectorHealth;
export function sanitizeOperationalReason(reason: unknown): string;
