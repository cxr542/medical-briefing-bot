const buckets = new Set(['support-quarantine', 'support-clean']);
export function checkedPath(path) {
  if (typeof path !== 'string' || !/^[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(path)) throw new Error('Invalid object path');
  for (const segment of path.split('/')) if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(segment)) throw new Error('Invalid object UUID');
  return path;
}
export function storageAdapter({ url, key, fetcher = fetch }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(base.hostname)) throw new Error('Storage requires TLS');
  function address(bucket, path) {
    if (!buckets.has(bucket)) throw new Error('Invalid bucket');
    return `${base.origin}/storage/v1/object/${bucket}/${checkedPath(path)}`;
  }
  return {
    async remove(bucket, path) {
      if (!buckets.has(bucket)) throw new Error('Invalid bucket');
      const response = await fetcher(`${base.origin}/storage/v1/object/${bucket}`, { method: 'DELETE', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [checkedPath(path)] }) });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Private storage removal failed'); }
      await response.body?.cancel();
    },
    async put(bucket, path, body, mime, bytes) {
      const response = await fetcher(address(bucket, path), { method: 'POST', body,
        duplex: 'half', redirect: 'error', signal: AbortSignal.timeout(60000),
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': mime, 'Content-Length': String(bytes), 'x-upsert': 'false' } });
      if (!response.ok) { await response.body?.cancel(); throw new Error('Private storage write failed'); }
      await response.body?.cancel();
    },
    async get(bucket, path) {
      const response = await fetcher(address(bucket, path), { redirect: 'error', signal: AbortSignal.timeout(60000), headers: { apikey: key, Authorization: `Bearer ${key}` } });
      if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error('Private storage read failed'); }
      return response;
    },
  };
}
