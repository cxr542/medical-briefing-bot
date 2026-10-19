import { createClient } from '@supabase/supabase-js';
import { storageAdapter } from '../src/lib/support/attachments/storage.mjs';
import { cleanupAttachments } from '../src/lib/support/attachments/cleanup.mjs';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || process.env.SUPPORT_ENABLED !== 'true' || process.env.SUPPORT_ATTACHMENTS_ENABLED !== 'true') throw new Error('Attachment maintenance is not configured');
const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
await cleanupAttachments({ storage: storageAdapter({ url, key }), rpc: async (operation, payload) => {
  const { data, error } = await client.rpc('support_attachment_worker_rpc', { operation, payload });
  if (error) throw new Error('Attachment maintenance failed');
  return data;
} });
