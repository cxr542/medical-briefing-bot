const VALID_SOURCE_STATUSES = new Set(['OK', 'WARN', 'FAILED']);

export function formatKstTimestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return '기록 없음';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(value));
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day} ${fields.hour}:${fields.minute}:${fields.second} KST`;
}

export function formatSourceHealthSummary(sourceHealth) {
  if (!sourceHealth || typeof sourceHealth !== 'object' || Array.isArray(sourceHealth)) {
    return 'source health 없음';
  }

  const counts = { OK: 0, WARN: 0, FAILED: 0 };
  for (const health of Object.values(sourceHealth)) {
    if (health && typeof health === 'object' && VALID_SOURCE_STATUSES.has(health.status)) {
      counts[health.status] += 1;
    }
  }

  if (counts.OK + counts.WARN + counts.FAILED === 0) return 'source health 없음';
  if (counts.WARN === 0 && counts.FAILED === 0) return `OK ${counts.OK}`;

  return [
    counts.OK > 0 ? `OK ${counts.OK}` : null,
    counts.WARN > 0 ? `WARN ${counts.WARN}` : null,
    counts.FAILED > 0 ? `FAILED ${counts.FAILED}` : null,
  ].filter(Boolean).join(' / ');
}
