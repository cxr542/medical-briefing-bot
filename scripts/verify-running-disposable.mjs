import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readdir, copyFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { prepareBundle, validatePending, HISTORY_MAPPING } from './prepare-running-deployment-bundle.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = process.env.RUNNING_LOCAL_CLI;
const contractRoot = process.env.RUNNING_CONTRACT_ROOT;
if (!cli || !contractRoot) throw new Error('RUNNING_LOCAL_CLI and RUNNING_CONTRACT_ROOT are required');
await access(cli);
await access(join(contractRoot, 'src/import/workoutContractV1.ts'));
assert.deepEqual((await readdir(join(root,'supabase/migrations'))).sort(),[
  ...HISTORY_MAPPING.filter(item => !item.sourceRoot).map(item => item.source),
  '20261002054701_running_core_v1.sql',
  '20261013043423_customer_auth_foundation.sql',
  '20261013050900_customer_admin_management.sql',
  '20261013062556_article_application_only.sql',
].sort(),'Review unexpected root migrations before starting disposable validation');
assert.deepEqual((await readdir(join(root,'medical-briefing-bot/supabase/migrations'))).sort(),HISTORY_MAPPING.filter(item => item.sourceRoot).map(item => item.source).sort(),'Review unexpected nested migrations before starting disposable validation');
const environment = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR };
const work = await mkdtemp(join(tmpdir(), 'running-main-disposable-'));
const project = `running-main-${Date.now()}`;
const dbContainer = `supabase_db_${project}`;
const deploymentVersion = '20261024000000'; // Disposable candidate only; no Production version approval.
async function availablePort() {
  const server = createServer();
  await new Promise((resolvePort,reject) => { server.once('error',reject); server.listen(0,'0.0.0.0',resolvePort); });
  const port = server.address().port;
  await new Promise((resolvePort,reject) => server.close(error => error ? reject(error) : resolvePort()));
  return port;
}
const ports = new Set();
while (ports.size < 3) ports.add(await availablePort());
const [apiPort,dbPort,shadowPort] = [...ports];
const redact = value => value.replace(/eyJ[A-Za-z0-9_.-]+/g, '[LOCAL_JWT_REDACTED]').replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, '[LOCAL_KEY_REDACTED]').replace(/^([│|]\s*(?:Access Key|Secret Key)\s*[│|]).*$/gmi,'$1 [LOCAL_KEY_REDACTED] │').replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[LOCAL_DB_URL_REDACTED]');
async function command(binary, args, options = {}) {
  return await new Promise((resolveResult, reject) => {
    const child = spawn(binary, args, { cwd: work, env: environment, stdio: ['pipe','pipe','pipe'], ...options });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', code => resolveResult({ code, stdout, stderr }));
    child.stdin.end(options.input);
  });
}
function success(result) {
  if (result.code !== 0) throw new Error(redact(result.stdout + result.stderr));
  return result.stdout;
}
const sql = (input, db = 'postgres') => command('docker', ['exec','-i',dbContainer,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',db], { input });
async function evidence(name, result) {
  await writeFile(join(work,name),redact(result.stdout + result.stderr),{flag:'wx'});
}
console.log(`Fresh disposable directory: ${work}`);
console.log(`Repository baseline: ${success(await command('git',['-C',root,'rev-parse','HEAD'])).trim()}`);
await mkdir(join(work,'supabase'));
await writeFile(join(work,'supabase/config.toml'),`project_id = "${project}"
[api]
enabled = true
port = ${apiPort}
schemas = ["public"]
extra_search_path = ["public", "extensions"]
[db]
port = ${dbPort}
shadow_port = ${shadowPort}
major_version = 17
[auth]
enabled = true
site_url = "http://localhost:3000"
enable_signup = true
[auth.email]
enable_signup = true
enable_confirmations = false
[studio]
enabled = false
[inbucket]
enabled = false
[analytics]
enabled = false
[edge_runtime]
enabled = false
[storage]
enabled = true
`,{flag:'wx'});
assert.deepEqual(await readdir(join(work,'supabase')),['config.toml'],'No migrations or linked metadata at startup');
console.log('Starting empty stack; no migrations present.');
try {
const started = await command(cli,['start','--exclude','realtime,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor']);
await evidence('startup.txt',started);
success(started);
const status = JSON.parse(success(await command(cli,['status','-o','json'])));
assert.equal(status.API_URL,`http://127.0.0.1:${apiPort}`);
assert.equal(success(await sql("SELECT count(*) FROM pg_namespace WHERE nspname='running';")).includes('\n     0\n'),true);
for (const name of ['medical_baseline.sql','production_history_baseline.sql']) success(await sql(`SET running_test.local_fixture='yes';\n${await readFile(join(root,'supabase/tests/fixtures',name),'utf8')}`));
// Reconstruct empty application schemas from reviewed repository SQL. Customer
// authentication exists remotely without corresponding ledger rows; do not invent them.
for (const path of [
  'supabase/migrations/20261007021457_article_keyword_boundary.sql',
  'supabase/migrations/20261012040738_article_source_detail_url.sql',
  'supabase/migrations/20261013043423_customer_auth_foundation.sql',
  'supabase/migrations/20261013050900_customer_admin_management.sql',
  'supabase/migrations/20261013062556_article_application_only.sql',
  ...HISTORY_MAPPING.filter(item => item.sourceRoot).map(item => `${item.sourceRoot}/${item.source}`),
  'medical-briefing-bot/supabase/provisioning/support_attachment_storage.sql',
]) success(await sql(await readFile(join(root,path),'utf8')));
success(await sql('UPDATE running_test.baseline SET snapshot=running_test.medical_snapshot();'));
const baselineGate = await sql(`DO $$ BEGIN
  IF (SELECT count(*) FROM information_schema.tables WHERE table_schema='customer_auth' AND table_type='BASE TABLE') <> 6
    OR (SELECT count(*) FROM information_schema.tables WHERE table_schema='support' AND table_type='BASE TABLE') <> 10
    OR (SELECT count(*) FROM storage.buckets) <> 2
    OR has_table_privilege('anon','public.articles','SELECT')
    OR has_table_privilege('authenticated','public.articles','SELECT')
    OR has_schema_privilege('anon','customer_auth','USAGE')
  THEN RAISE EXCEPTION 'Current synthetic baseline incomplete'; END IF;
END $$;`);
success(baselineGate);
success(await sql('CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;'));
console.log('Empty startup completed; synthetic medical/history baselines loaded.');
const history = JSON.parse(await readFile(join(root,'supabase/tests/fixtures/production-history.json'),'utf8'));
const historyActual = JSON.parse(success(await sql("SELECT json_agg(row_to_json(x)) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version) x;" )).split('\n').find(line=>line.trim().startsWith('[')));
assert.deepEqual(historyActual,history);
const bundle = await prepareBundle({root,output:join(work,'initial-bundle'),history,deploymentVersion});
await mkdir(join(work,'supabase/migrations'));
for (const item of [...bundle.history_mapping,bundle.new_migration]) await copyFile(join(work,'initial-bundle/supabase/migrations',item.destination),join(work,'supabase/migrations',item.destination));
const dry = await command(cli,['db','push','--local','--dry-run']);
success(dry); await evidence('dry-run.txt',dry);
const pending = [...(dry.stdout+dry.stderr).matchAll(/(\d{14})_[^\s]+\.sql/g)].map(match=>match[1]);
validatePending(pending,bundle.new_migration.version);
await prepareBundle({root,output:join(work,'verified-bundle'),history,pending,deploymentVersion});
console.log(`Pending gate passed: ${pending.join(',')}; verified manifest pending_verified=true.`);
const migration = await readFile(join(root,'supabase/migrations',bundle.new_migration.source),'utf8');
const failed = await sql(migration.replace(/COMMIT;\s*$/,'SELECT 1/0;\nCOMMIT;'));
assert.notEqual(failed.code,0); assert.match(failed.stderr,/division by zero/);
const rollback = await sql("SELECT NOT EXISTS(SELECT FROM pg_namespace WHERE nspname='running') AND running_test.medical_snapshot()=(SELECT snapshot FROM running_test.baseline) AS rollback_ok;");
success(rollback); assert.match(rollback.stdout,/\n t\s*\n/); await evidence('rollback.txt',rollback);
const applied = await command(cli,['db','push','--local','--yes']);
success(applied); await evidence('migration-apply.txt',applied);
const tap = await sql(await readFile(join(root,'supabase/tests/running_core_v1.test.sql'),'utf8'));
await evidence('pgtap.txt',tap); success(tap);
assert.doesNotMatch(tap.stdout,/not ok/);
assert.equal((tap.stdout.match(/\bok \d+ -/g)??[]).length,88);
console.log('pgTAP: 88/88 PASS.');
success(await sql("ALTER ROLE authenticator SET pgrst.db_schemas='public,running'; NOTIFY pgrst,'reload config'; NOTIFY pgrst,'reload schema';"));
const api = await command(process.execPath,['--test',join(root,'supabase/tests/running_api_integration.mjs')],{env:{...environment,RUNNING_CONTRACT_ROOT:contractRoot,RUNNING_LOCAL_URL:status.API_URL,RUNNING_LOCAL_ANON_KEY:status.ANON_KEY,RUNNING_LOCAL_SERVICE_KEY:status.SERVICE_ROLE_KEY}});
await evidence('api.txt',api); success(api);
console.log(redact(api.stdout));
const catalog = await sql("SELECT running_test.medical_snapshot()=(SELECT snapshot FROM running_test.baseline) AS medical_unchanged; SELECT count(*) FROM auth.users; SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version;");
success(catalog); assert.match(catalog.stdout,/\n t\s*\n/); await evidence('catalog.txt',catalog);
success(await sql("DO $$ BEGIN IF EXISTS(SELECT FROM auth.users) THEN RAISE EXCEPTION 'Synthetic Auth users remain'; END IF; END $$;"));
const finalHistory = JSON.parse(success(await sql("SELECT json_agg(row_to_json(x)) FROM (SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version) x;")).split('\n').find(line => line.trim().startsWith('[')));
assert.deepEqual(finalHistory,[...history,{version:deploymentVersion,name:'running_core_v1'}],'Only the new running ledger row may be added');
console.log('Rollback and medical catalog: PASS. Synthetic Auth users cleaned up.');
console.log(`Artifacts preserved: ${work}. No production connection.`);
} finally {
  const stopped = await command(cli,['stop','--project-id',project,'--no-backup']);
  await evidence('cleanup.txt',stopped);
  success(stopped);
  console.log('Owned disposable stack removed; pre-existing stacks preserved.');
}
