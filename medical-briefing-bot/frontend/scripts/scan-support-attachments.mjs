import { createClient } from '@supabase/supabase-js';
import { storageAdapter } from '../src/lib/support/attachments/storage.mjs';
import { clamAvScanner } from '../src/lib/support/attachments/scanner.mjs';
import { scanNext } from '../src/lib/support/attachments/worker.mjs';

if (process.env.SUPPORT_ENABLED !== 'true' || process.env.SUPPORT_ATTACHMENTS_ENABLED !== 'true') throw new Error('Support attachments are disabled');
const scanner = clamAvScanner({ host: process.env.SUPPORT_CLAMAV_HOST, port: Number(process.env.SUPPORT_CLAMAV_PORT || 3310) });
if (!scanner.configured) throw new Error('A real ClamAV service must be configured before scanning');
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Worker credentials are missing');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
await scanNext({ scanner, storage: storageAdapter({ url, key }), async rpc(operation, payload) {
  const { data, error } = await client.rpc('support_attachment_worker_rpc', { operation, payload });
  if (error) throw new Error('Worker database operation failed');
  return data;
} });
