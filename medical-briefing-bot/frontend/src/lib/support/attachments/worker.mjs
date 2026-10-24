import { mkdtemp, open, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validateFile } from './validation.mjs';

export async function scanNext({ rpc, storage, scanner }) {
  if (!scanner.configured) throw new Error('Production scanner is not configured');
  const job = await rpc('claim', {});
  if (!job) return false;
  const dir = await mkdtemp(join(tmpdir(), 'support-scan-'));
  const path = join(dir, 'payload');
  let status = 'failed'; let cleanPath;
  try {
    const file = await open(path, 'wx', 0o600);
    let total = 0;
    try {
      if (!Array.isArray(job.parts) || job.parts.length !== Math.ceil(job.bytes / 1048576)) throw new Error('Missing upload parts');
      for (let index = 0; index < job.parts.length; index++) {
        const part = job.parts[index];
        if (part.part !== index || part.bytes !== Math.min(1048576, job.bytes - total)) throw new Error('Invalid part ordering');
        const response = await storage.get('support-quarantine', part.object_path);
        const digest = createHash('sha256'); let received = 0;
        try {
          for await (const chunk of response.body) {
            received += chunk.length; total += chunk.length;
            if (received > part.bytes || total > job.bytes || total > 10485760) throw new Error('Upload exceeds reservation');
            digest.update(chunk);
            let offset = 0;
            while (offset < chunk.length) {
              const { bytesWritten } = await file.write(chunk, offset, chunk.length - offset);
              if (!bytesWritten) throw new Error('Unable to spool upload');
              offset += bytesWritten;
            }
          }
        } finally { await response.body?.cancel().catch(() => {}); }
        if (received !== part.bytes || digest.digest('hex') !== part.sha256) throw new Error('Part integrity failure');
      }
    } finally { await file.close(); }
    await validateFile(path, job);
    const verdict = await scanner.scan(path);
    if (verdict !== 'clean' && verdict !== 'infected') throw new Error('Invalid scanner verdict');
    status = verdict;
    if (status === 'clean') {
      cleanPath = `${job.request_id}/${job.id}/${job.scan_lease}`;
      await storage.put('support-clean', cleanPath, createReadStream(path), job.mime, job.bytes);
    }
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    status = 'failed';
  } finally { await rm(dir, { recursive: true, force: true }); }
  await rpc('finish', { attachment_id: job.id, lease: job.scan_lease, sha256: job.sha256, status, ...(status === 'clean' ? { clean_path: cleanPath } : {}) });
  return true;
}
