import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, cp, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HISTORY_MAPPING, prepareBundle as prepare, validateHistory, validatePending } from './prepare-running-deployment-bundle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const history = HISTORY_MAPPING.map(({ version, name }) => ({ version, name }));
const deploymentVersion = '20261024000000'; // Synthetic local candidate, not a Production approval.
const prepareBundle = options => prepare({ deploymentVersion, ...options });
test('produces an offline bundle with exact original hashes and no config', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'running-bundle-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const manifest = await prepareBundle({ root, output: join(temp, 'bundle'), history });
  assert.equal(manifest.history_mapping.length, 7);
  assert.equal(manifest.production_approved, false);
  assert.equal(manifest.new_migration.source_version, '20261002054701');
  assert.equal(manifest.new_migration.version, deploymentVersion);
  assert.equal(await readFile(join(temp,'bundle/supabase/migrations',manifest.new_migration.destination),'utf8'), await readFile(join(root,'supabase/migrations',manifest.new_migration.source),'utf8'));
  assert.equal(manifest.pending_verified, false);
  assert.deepEqual(await readdir(join(temp, 'bundle')), ['manifest.json','supabase']);
  assert.equal((await readdir(join(temp, 'bundle', 'supabase', 'migrations'))).length, 8);
  assert.equal(await readFile(join(temp, 'bundle', 'supabase', 'migrations', manifest.history_mapping[0].destination), 'utf8'), await readFile(join(root, 'supabase','migrations',HISTORY_MAPPING[0].source),'utf8'));
  validatePending([manifest.new_migration.version], manifest.new_migration.version);
  await assert.rejects(prepareBundle({ root, output: join(temp, 'bundle'), history }), { code: 'EEXIST' });
});
test('rejects changed or extra history', () => {
  assert.throws(() => validateHistory([{ version: 'wrong', name: 'wrong' }]));
  assert.throws(() => validateHistory([...history, { version: 'extra', name: 'extra' }]));
  assert.throws(() => validateHistory([...history.slice(0,-1),history[0]]));
});
test('rejects pending old migrations or no pending migration', () => {
  assert.throws(() => validatePending([], '20261002054701'));
  assert.throws(() => validatePending(['20260928064906','20261002054701'], '20261002054701'));
});
test('rejects tampered source before writing output', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'running-tamper-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await cp(join(root,'supabase'),join(temp,'supabase'),{recursive:true});
  await cp(join(root,'medical-briefing-bot/supabase'),join(temp,'medical-briefing-bot/supabase'),{recursive:true});
  const migrations = join(temp, 'supabase','migrations');
  await appendFile(join(migrations,HISTORY_MAPPING[0].source),'-- altered\n');
  await assert.rejects(prepareBundle({ root: temp, output: join(temp,'bundle'), history }), /hash changed/);
  assert.equal((await readdir(temp)).includes('bundle'), false);
});
test('requires a valid explicit version after the latest history', async t => {
  const temp = await mkdtemp(join(tmpdir(),'running-version-test-'));
  t.after(() => rm(temp,{recursive:true,force:true}));
  for (const candidate of [undefined,'20261002054701','20261019041429','20261324000000','20260230000000','../../escape']) {
    await assert.rejects(prepareBundle({root,output:join(temp,'bundle'),history,deploymentVersion:candidate}));
  }
  assert.deepEqual(await readdir(temp),[]);
});
test('verifies the entire mapped history and immutable running source before output', async t => {
  const temp = await mkdtemp(join(tmpdir(),'running-all-hashes-test-'));
  t.after(() => rm(temp,{recursive:true,force:true}));
  await cp(join(root,'supabase'),join(temp,'supabase'),{recursive:true});
  await cp(join(root,'medical-briefing-bot/supabase'),join(temp,'medical-briefing-bot/supabase'),{recursive:true});
  const {writeFile} = await import('node:fs/promises');
  for (const item of [...HISTORY_MAPPING,{source:'20261002054701_running_core_v1.sql'}]) {
    const path = join(temp,item.sourceRoot ?? 'supabase/migrations',item.source);
    const original = await readFile(path);
    await appendFile(path,'\n-- tampered\n');
    await assert.rejects(prepareBundle({root:temp,output:join(temp,'bundle'),history}),/hash changed/);
    await writeFile(path,original);
  }
  assert.equal((await readdir(temp)).includes('bundle'),false);
  const manifest=await prepareBundle({root:temp,output:join(temp,'bundle'),history,pending:[deploymentVersion]});
  assert.equal(manifest.pending_verified,true);
  assert.equal(manifest.production_approved,false);
});
