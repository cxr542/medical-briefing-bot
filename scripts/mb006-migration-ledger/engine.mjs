import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { MIGRATIONS, LEGACY, LOCK, filename, key, literal, LedgerError } from './manifest.mjs';
import { checkedBody } from './sql-boundaries.mjs';
import { readTarget, proveIsolation, sql, audit } from './target.mjs';
import { assertObjects } from './objects.mjs';

export async function loadMigration(version) {
  const item = MIGRATIONS.find(migration => migration.version === version);
  if (!item) throw new LedgerError('VERSION_NOT_ALLOWLISTED');
  const path = new URL(`../../medical-briefing-bot/supabase/migrations/${filename(item)}`, import.meta.url);
  if ((await lstat(path)).isSymbolicLink()) throw new LedgerError('MIGRATION_SYMLINK_FORBIDDEN');
  const source = await readFile(path, 'utf8');
  return { ...item, source, body: checkedBody(source, item) };
}

const legacyRows = LEGACY.map(([version, name]) => [version, null, name, null, null, null]);
export const historyQuery = `SELECT coalesce(jsonb_agg(jsonb_build_array(version,statements,name,created_by,idempotency_key,rollback) ORDER BY version),'[]'::jsonb) FROM supabase_migrations.schema_migrations`;
const legacyQuery = `${historyQuery} WHERE version IN (${LEGACY.map(row => literal(row[0])).join(',')})`;

async function assertSchema(target) {
  const shape = JSON.parse(await sql(target, `SELECT jsonb_build_object('columns',(
    SELECT jsonb_agg(jsonb_build_array(column_name,udt_name,is_nullable,column_default) ORDER BY ordinal_position)
    FROM information_schema.columns WHERE table_schema='supabase_migrations' AND table_name='schema_migrations'),
    'constraints',(SELECT jsonb_agg(pg_get_constraintdef(oid) ORDER BY contype) FROM pg_constraint WHERE conrelid='supabase_migrations.schema_migrations'::regclass),
    'indexes',(SELECT count(*) FROM pg_index WHERE indrelid='supabase_migrations.schema_migrations'::regclass),
    'acl',(SELECT relacl::text FROM pg_class WHERE oid='supabase_migrations.schema_migrations'::regclass),
    'owner',(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='supabase_migrations.schema_migrations'::regclass),
    'rls',(SELECT jsonb_build_array(relrowsecurity,relforcerowsecurity) FROM pg_class WHERE oid='supabase_migrations.schema_migrations'::regclass));`));
  const expected = { columns: [['version','text','NO',null],['statements','_text','YES',null],['name','text','YES',null],
    ['created_by','text','YES',null],['idempotency_key','text','YES',null],['rollback','_text','YES',null]],
    constraints: ['PRIMARY KEY (version)','UNIQUE (idempotency_key)'], indexes: 2, acl: null, owner: 'postgres', rls: [false,false] };
  if (JSON.stringify(shape.columns) !== JSON.stringify(expected.columns)
    || JSON.stringify(shape.constraints) !== JSON.stringify(expected.constraints) || shape.indexes !== 2
    || shape.acl !== null || shape.owner !== 'postgres' || JSON.stringify(shape.rls) !== '[false,false]') throw new LedgerError('LEDGER_SCHEMA_MISMATCH');
}

export async function inspectState(target) {
  await assertSchema(target);
  const rows = JSON.parse(await sql(target, historyQuery));
  const legacy = rows.filter(row => LEGACY.some(old => old[0] === row[0]));
  if (JSON.stringify(legacy) !== JSON.stringify(legacyRows)) throw new LedgerError('LEGACY_HISTORY_MISMATCH');
  const applied = rows.filter(row => !LEGACY.some(old => old[0] === row[0]));
  for (let index = 0; index < applied.length; index++) {
    const migration = MIGRATIONS[index];
    const row = applied[index];
    if (!migration || row[0] !== migration.version || row[2] !== migration.name || row[3] !== 'postgres'
      || row[4] !== key(migration) || row[5] !== null || !Array.isArray(row[1]) || row[1].length !== 1
      || createHash('sha256').update(row[1][0]).digest('hex') !== migration.sha256) throw new LedgerError('APPLIED_HISTORY_MISMATCH');
  }
  await assertObjects(target, applied.length);
  return { count: rows.length, applied: applied.map(row => row[0]), legacy: LEGACY.map(row => row[0]) };
}

export async function runMigration({ descriptor, version, mode = 'validate' }) {
  if (!['validate','apply'].includes(mode)) throw new LedgerError('INVALID_MODE');
  const migration = await loadMigration(version);
  const target = await readTarget(descriptor);
  const identity = await proveIsolation(target);
  const record = { mode, version, file: filename(migration), files: [filename(migration)], sha256: migration.sha256, target: identity };
  let pre;
  try { pre = await inspectState(target); }
  catch (error) {
    await audit(target, { ...record, event: 'REJECTED_STATE', code: error instanceof LedgerError ? error.code : 'STATE_QUERY_FAILED' });
    throw error;
  }
  await audit(target, { ...record, event: 'BEGIN_VALIDATION', history: pre });
  const index = MIGRATIONS.findIndex(item => item.version === version);
  if (pre.applied.includes(version)) { await audit(target, { ...record, event: 'REJECTED_DUPLICATE' }); throw new LedgerError('ALREADY_APPLIED'); }
  if (pre.applied.length !== index) { await audit(target, { ...record, event: 'REJECTED_ORDER' }); throw new LedgerError('MIGRATION_ORDER'); }
  if (mode === 'validate') {
    await audit(target, { ...record, event: 'DRY_RUN', history: pre });
    return { result: 'DRY_RUN', ...record, history: pre };
  }
  const expectedHistory = literal(JSON.stringify([...legacyRows, ...await Promise.all(MIGRATIONS.slice(0, index).map(async item => {
    const previous = await loadMigration(item.version);
    return [item.version, [previous.source], item.name, 'postgres', key(item), null];
  }))]));
  const targetHistory = `${historyQuery}`;
  const statement = `BEGIN;
SET LOCAL lock_timeout='1s'; SET LOCAL statement_timeout='10s'; SET LOCAL idle_in_transaction_session_timeout='15s';
SET LOCAL application_name='mb006-atomic-ledger'; SET LOCAL search_path='';
DO $mb006_guard$ BEGIN
  IF NOT pg_try_advisory_xact_lock(${LOCK}) THEN RAISE EXCEPTION 'MIGRATION_LOCK_BUSY'; END IF;
  IF current_database()<>'medical_mb006_ledger' OR current_setting('listen_addresses')<>'' OR inet_server_addr() IS NOT NULL
    OR (SELECT nonce FROM mb006_ledger_guard.identity)<>${literal(target.nonce)}
    OR (SELECT system_identifier::text FROM pg_control_system())<>${literal(target.system)}
    OR (SELECT oid::text FROM pg_database WHERE datname=current_database())<>${literal(target.oid)} THEN RAISE EXCEPTION 'SERVER_IDENTITY_MISMATCH'; END IF;
  IF (${targetHistory})<>${expectedHistory}::jsonb THEN RAISE EXCEPTION 'HISTORY_CHANGED_OR_ORDER_INVALID'; END IF;
END $mb006_guard$;
${migration.body}
INSERT INTO supabase_migrations.schema_migrations(version,statements,name,created_by,idempotency_key)
VALUES (${literal(version)},ARRAY[${literal(migration.source)}],${literal(migration.name)},current_user,${literal(key(migration))});
DO $mb006_preserve$ BEGIN
  IF (${legacyQuery})<>${literal(JSON.stringify(legacyRows))}::jsonb THEN RAISE EXCEPTION 'LEGACY_HISTORY_CHANGED'; END IF;
END $mb006_preserve$;
COMMIT;`;
  try {
    await sql(target, statement);
    const post = await inspectState(target);
    await audit(target, { ...record, event: 'COMMIT_CONFIRMED', history: post });
    return { result: 'COMMIT_CONFIRMED', ...record, history: post };
  } catch {
    await audit(target, { ...record, event: 'FAILED_RECONCILE_BEFORE_RETRY' });
    throw new LedgerError('EXECUTION_FAILED_RECONCILE_BEFORE_RETRY');
  }
}
