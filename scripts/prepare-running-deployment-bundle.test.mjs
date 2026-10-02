import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, mkdir, copyFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HISTORY_MAPPING, prepareBundle, validateHistory, validatePending } from './prepare-running-deployment-bundle.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const history = HISTORY_MAPPING.map(({ version, name }) => ({ version, name }));
test('produces an offline bundle with exact original hashes and no config', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'running-bundle-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const manifest = await prepareBundle({ root, output: join(temp, 'bundle'), history });
  assert.equal(manifest.history_mapping.length, 2);
  assert.equal(manifest.pending_verified, false);
  assert.deepEqual(await readdir(join(temp, 'bundle')), ['manifest.json','supabase']);
  assert.equal((await readdir(join(temp, 'bundle', 'supabase', 'migrations'))).length, 3);
  assert.equal(await readFile(join(temp, 'bundle', 'supabase', 'migrations', manifest.history_mapping[0].destination), 'utf8'), await readFile(join(root, 'supabase','migrations',HISTORY_MAPPING[0].source),'utf8'));
  validatePending([manifest.new_migration.version], manifest.new_migration.version);
  await assert.rejects(prepareBundle({ root, output: join(temp, 'bundle'), history }), { code: 'EEXIST' });
});
test('rejects changed or extra history', () => {
  assert.throws(() => validateHistory([{ version: 'wrong', name: 'wrong' }]));
  assert.throws(() => validateHistory([...history, { version: 'extra', name: 'extra' }]));
});
test('rejects pending old migrations or no pending migration', () => {
  assert.throws(() => validatePending([], '20261002054701'));
  assert.throws(() => validatePending(['20260928064906','20261002054701'], '20261002054701'));
});
test('rejects tampered source before writing output', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'running-tamper-test-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const migrations = join(temp, 'supabase','migrations');
  await mkdir(migrations, { recursive: true });
  for (const file of await readdir(join(root,'supabase','migrations'))) await copyFile(join(root,'supabase','migrations',file),join(migrations,file));
  await appendFile(join(migrations,HISTORY_MAPPING[0].source),'-- altered\n');
  await assert.rejects(prepareBundle({ root: temp, output: join(temp,'bundle'), history }), /hash changed/);
  assert.equal((await readdir(temp)).includes('bundle'), false);
});
