import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tokenHash } from '../../src/lib/customer-auth/core.mjs';
import { TOKEN_A, ADMIN_A } from './supportDatabase.mjs';

const apps = [];
const auth = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks).toString() || '{}');
  response.setHeader('Content-Type', 'application/json');
  if (request.url !== '/rest/v1/rpc/customer_auth_rpc' || body.operation !== 'validate_session') {
    response.writeHead(403).end('{}'); return;
  }
  response.end(JSON.stringify(body.payload?.kind === 'admin' && body.payload?.token_hash === tokenHash(TOKEN_A) ? { id: ADMIN_A } : null));
});
auth.listen(0, '127.0.0.1');
await once(auth, 'listening');
const databaseOrigin = `http://127.0.0.1:${auth.address().port}`;
const env = { ...process.env, NODE_ENV: 'production', CUSTOMER_AUTH_FOUNDATION_ENABLED: 'true',
  CUSTOMER_AUTH_ENFORCEMENT_ENABLED: 'false', NEXT_PUBLIC_SUPABASE_URL: databaseOrigin,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'ui-local-anon', SUPABASE_SERVICE_ROLE_KEY: 'ui-local-service',
  ADMIN_PASSWORD: 'ui-local-internal-password-123456' };
const build = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build', ...(process.env.SUPPORT_TEST_WEBPACK === '1' ? ['--webpack'] : [])], { stdio: 'inherit', env });
const [code] = await once(build, 'exit');
if (code !== 0) { auth.close(); process.exit(code || 1); }
for (const [port, flag, attachments] of [[3027, 'true', 'true'], [3028, 'false', 'false'], [3029, 'true', 'false']]) {
  apps.push(spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    stdio: 'inherit', env: { ...env, SUPPORT_ENABLED: flag, SUPPORT_ATTACHMENTS_ENABLED: attachments },
  }));
}
async function stop() {
  for (const app of apps) app.kill('SIGTERM');
  auth.close();
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
