import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile, readdir, lstat } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HISTORY_MAPPING = [
  { source: '20260928000000_collector_alert_state.sql', version: '20260928064906', name: 'collector_alert_state', sha256: 'b99c64a3ff71a9a313ad865e069b314468a73cfd3849b3faf86df7ac1d9d0c0b' },
  { source: '20260928010000_collector_runs_admin_only.sql', version: '20260929063328', name: '20260928010000_collector_runs_admin_only', sha256: 'c07251270dd8dcacc96d4f6f444ea88cab46b0db767d0f5676bbcf1f57141d41' },
];
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = content => createHash('sha256').update(content).digest('hex');

export function validateHistory(history) {
  if (!Array.isArray(history) || history.length !== HISTORY_MAPPING.length) throw new Error('History differs from the approved baseline');
  for (const item of HISTORY_MAPPING) {
    if (!history.some(row => row.version === item.version && row.name === item.name)) throw new Error('History version/name differs from baseline');
  }
}

export function validatePending(pending, newVersion) {
  if (!Array.isArray(pending) || pending.length !== 1 || pending[0] !== newVersion) throw new Error('Pending migrations must contain only the new running version');
}

export async function prepareBundle({ root = ROOT, output, history, pending }) {
  validateHistory(history);
  const migrationRoot = join(root, 'supabase', 'migrations');
  const paths = (await readdir(migrationRoot)).filter(name => /^\d{14}_running_core_v1\.sql$/.test(name));
  if (paths.length !== 1) throw new Error('Exactly one running core migration is required');
  const newName = paths[0];
  const newVersion = newName.slice(0, 14);
  if (newVersion <= HISTORY_MAPPING.at(-1).version) throw new Error('New version must follow Production history');
  if (pending !== undefined) validatePending(pending, newVersion);
  const sources = [];
  for (const mapping of HISTORY_MAPPING) {
    const path = join(migrationRoot, mapping.source);
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Migration symlinks are forbidden');
    const content = await readFile(path, 'utf8');
    if (hash(content) !== mapping.sha256) throw new Error('Original migration hash changed');
    sources.push({ ...mapping, content, destination: `${mapping.version}_${mapping.name}.sql` });
  }
  const newPath = join(migrationRoot, newName);
  if ((await lstat(newPath)).isSymbolicLink()) throw new Error('Migration symlinks are forbidden');
  const content = await readFile(newPath, 'utf8');
  if (!/^BEGIN;/i.test(content.trim()) || !/COMMIT;$/i.test(content.trim())) throw new Error('Running migration must be transactional');
  if (/\b(?:DROP|TRUNCATE)\b|\bpublic\s*\.|\bALTER\s+DEFAULT\s+PRIVILEGES\b/i.test(content)) throw new Error('Running migration crosses the approved boundary');
  if (/sb_secret_|sb_publishable_|service_role_key|database_password|eyJ[A-Za-z0-9_-]{20}/i.test(content)) throw new Error('Possible credential in migration');
  const requested = resolve(output);
  const destination = join(await realpath(dirname(requested)), basename(requested));
  await mkdir(destination);
  await mkdir(join(destination, 'supabase'));
  await mkdir(join(destination, 'supabase', 'migrations'));
  for (const item of sources) await writeFile(join(destination, 'supabase', 'migrations', item.destination), item.content, { flag: 'wx' });
  await writeFile(join(destination, 'supabase', 'migrations', newName), content, { flag: 'wx' });
  const manifest = {
    format_version: 1,
    source_repository: 'cxr542/medical-briefing-bot',
    baseline_remote_head: 'f3b892815520fed72ba0bdd8970924eea9676086',
    history_mapping: sources.map(({ content: ignored, ...item }) => item),
    new_migration: { source: newName, destination: newName, version: newVersion, sha256: hash(content) },
    expected_pending_versions: [newVersion],
    history_evidence: 'Caller-supplied offline version/name snapshot; no remote connection',
    pending_verified: pending !== undefined,
    instructions: 'Never replay history mirrors. Validate local disposable baseline and actual dry-run before deployment. No credentials or linked project configuration included.',
  };
  await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--output','--history','--pending'].includes(args[index]) || !args[index + 1] || options.has(args[index])) throw new Error('Usage: --output NEW_DIRECTORY --history OFFLINE_JSON [--pending OFFLINE_JSON]');
    options.set(args[index], args[index + 1]);
  }
  if (!options.has('--output') || !options.has('--history')) throw new Error('--output and --history are required');
  const history = JSON.parse(await readFile(options.get('--history'), 'utf8'));
  const pending = options.has('--pending') ? JSON.parse(await readFile(options.get('--pending'), 'utf8')) : undefined;
  const manifest = await prepareBundle({ output: options.get('--output'), history, pending });
  console.log(JSON.stringify({ new_version: manifest.new_migration.version, pending_verified: manifest.pending_verified }));
}
