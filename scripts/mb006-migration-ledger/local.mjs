import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { docker, sql, readTarget, proveIsolation } from './target.mjs';
import { IMAGE, DATABASE, LEGACY, literal, LedgerError } from './manifest.mjs';

export async function provision() {
  const nonce = randomBytes(16).toString('hex');
  const directory = await mkdtemp(join(tmpdir(), 'mb006-ledger-'));
  const image = JSON.parse(await docker(['image', 'inspect', IMAGE]))[0].Id;
  const name = `mb006-ledger-${nonce}`;
  const container = await docker(['run', '--pull=never', '-d', '--name', name, '--network', 'none',
    '--label', `mb006.atomic.nonce=${nonce}`, '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', `POSTGRES_DB=${DATABASE}`,
    image, 'postgres', '-c', "listen_addresses="]);
  const target = { kind: 'mb006-local-only-v1', container, name, image, nonce, system: '', database: DATABASE, oid: '' };
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const state = JSON.parse(await docker(['inspect', container]))[0];
        if (state.State.Running && Number(state.State.Pid) > 0) {
          const process = await docker(['exec', container, 'sh', '-c', 'test "$(head -1 /proc/1/comm)" = postgres && test "$(wc -l < /proc/net/unix)" -gt 1']);
          await sql(target, 'SELECT 1;');
          if (process === '') { ready = true; break; }
        }
      } catch (error) {
        if (!(error instanceof LedgerError)) throw error;
      }
      await delay(100);
    }
    if (!ready) throw new LedgerError('LOCAL_DATABASE_NOT_READY');
    await sql(target, `CREATE SCHEMA mb006_ledger_guard; CREATE TABLE mb006_ledger_guard.identity(nonce text NOT NULL PRIMARY KEY);
      INSERT INTO mb006_ledger_guard.identity VALUES (${literal(nonce)});
      CREATE SCHEMA supabase_migrations;
      CREATE TABLE supabase_migrations.schema_migrations (
        version text PRIMARY KEY, statements text[], name text, created_by text, idempotency_key text UNIQUE, rollback text[]);
      INSERT INTO supabase_migrations.schema_migrations(version,name) VALUES ${LEGACY.map(([version, migration]) => `(${literal(version)},${literal(migration)})`).join(',')};
      CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;`);
    for (const file of ['20261013043423_customer_auth_foundation.sql','20261013050900_customer_admin_management.sql']) {
      await sql(target, await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    }
    await sql(target, `INSERT INTO customer_auth.customer_admins(id,login_id,password_hash) VALUES ('11111111-1111-4111-8111-111111111111','synthetic-phase4','$argon2id$synthetic-only');
      INSERT INTO customer_auth.customer_sessions(token_hash,kind,admin_id,credential_version,principal_version,expires_at)
        VALUES (repeat('0',64),'admin','11111111-1111-4111-8111-111111111111',1,1,now()+interval '45 minutes');
      CREATE TABLE public.articles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), title text);
      INSERT INTO public.articles(title) VALUES ('synthetic preservation sentinel');
      CREATE TABLE public.collector_runs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text);
      INSERT INTO public.collector_runs(status) VALUES ('synthetic-not-a-collector-run');`);
    await sql(target, await readFile(new URL('../../supabase/migrations/20260928000000_collector_alert_state.sql', import.meta.url),'utf8'));
    const identity = JSON.parse(await sql(target, `SELECT jsonb_build_object('system',(SELECT system_identifier::text FROM pg_control_system()),'oid',(SELECT oid FROM pg_database WHERE datname=current_database()));`));
    target.system = identity.system; target.oid = String(identity.oid);
    const descriptor = join(directory, 'local-target.json');
    await writeFile(descriptor, JSON.stringify(target) + '\n', { flag: 'wx', mode: 0o600 });
    await writeFile(join(directory, 'audit.jsonl'), '', { flag: 'wx', mode: 0o600 });
    await proveIsolation({ ...target, descriptor });
    return { descriptor, directory };
  } catch (error) {
    await docker(['rm', '-fv', container]);
    throw error;
  }
}

export async function cleanup(descriptor) {
  const target = await readTarget(descriptor);
  await proveIsolation(target);
  const [container] = JSON.parse(await docker(['inspect', target.container]));
  for (const mount of container.Mounts) {
    const users = (await docker(['ps', '-aq', '--no-trunc', '--filter', `volume=${mount.Name}`])).split('\n').filter(Boolean);
    if (users.some(id => id !== target.container)) throw new LedgerError('SHARED_VOLUME_CLEANUP_REFUSED');
  }
  await docker(['rm', '-fv', target.container]);
  return { result: 'CLEANED', container: target.container, evidence_directory: join(descriptor, '..') };
}
