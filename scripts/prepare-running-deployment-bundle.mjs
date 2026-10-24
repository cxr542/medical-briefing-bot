import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile, readdir, lstat } from 'node:fs/promises';
import { resolve, dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

export const HISTORY_MAPPING = [
  { source: '20260928000000_collector_alert_state.sql', version: '20260928064906', name: 'collector_alert_state', sha256: 'b99c64a3ff71a9a313ad865e069b314468a73cfd3849b3faf86df7ac1d9d0c0b' },
  { source: '20260928010000_collector_runs_admin_only.sql', version: '20260929063328', name: '20260928010000_collector_runs_admin_only', sha256: 'c07251270dd8dcacc96d4f6f444ea88cab46b0db767d0f5676bbcf1f57141d41' },
  { source: '20261007021457_article_keyword_boundary.sql', version: '20261007041102', name: 'article_keyword_boundary', sha256: 'f8af9294e644da254e4df0afc9c1482d6a675c553bc8582b2c7cb6e813b1f800' },
  { source: '20261012040738_article_source_detail_url.sql', version: '20261012043225', name: 'article_source_detail_url', sha256: 'b130bdb62542d039cabcb0a7c687853dd23b5f97ecda84bdc0827103d385fa4c' },
  { sourceRoot: 'medical-briefing-bot/supabase/migrations', source: '20261016014502_support_foundation.sql', version: '20261016014502', name: 'support_foundation', sha256: 'f9b2b15520eea9686d11703bf6b99a1e1cc33e6b354ec44f0c1a6bfb4bfa8af6' },
  { sourceRoot: 'medical-briefing-bot/supabase/migrations', source: '20261016035115_support_attachments.sql', version: '20261016035115', name: 'support_attachments', sha256: '6c462bbf80b8469856be36d52c506e0372f6eb539c2551d0610b24226cacbd8b' },
  { sourceRoot: 'medical-briefing-bot/supabase/migrations', source: '20261019041429_support_conflict_sqlstate.sql', version: '20261019041429', name: 'support_conflict_sqlstate', sha256: '610a8328a118e4c457acafb81fcdd28a3993efcd770f412ca7a04cdf4bf05da1' },
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

export async function prepareBundle({ root = ROOT, output, history, pending, deploymentVersion }) {
  validateHistory(history);
  const migrationRoot = join(root, 'supabase', 'migrations');
  const paths = (await readdir(migrationRoot)).filter(name => /^\d{14}_running_core_v1\.sql$/.test(name));
  if (paths.length !== 1) throw new Error('Exactly one running core migration is required');
  const sourceName = paths[0];
  const newVersion = deploymentVersion;
  if (typeof newVersion !== 'string' || !/^\d{14}$/.test(newVersion)) throw new Error('Explicit 14-digit deploymentVersion is required');
  const iso = `${newVersion.slice(0,4)}-${newVersion.slice(4,6)}-${newVersion.slice(6,8)}T${newVersion.slice(8,10)}:${newVersion.slice(10,12)}:${newVersion.slice(12,14)}Z`;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime()) || date.toISOString().replace(/\D/g,'').slice(0,14) !== newVersion) throw new Error('Invalid deploymentVersion timestamp');
  const newName = `${newVersion}_running_core_v1.sql`;
  if (newVersion <= HISTORY_MAPPING.at(-1).version) throw new Error('New version must follow Production history');
  if (pending !== undefined) validatePending(pending, newVersion);
  const sources = [];
  for (const mapping of HISTORY_MAPPING) {
    const path = join(root, mapping.sourceRoot ?? 'supabase/migrations', mapping.source);
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Migration symlinks are forbidden');
    const content = await readFile(path, 'utf8');
    if (hash(content) !== mapping.sha256) throw new Error('Original migration hash changed');
    sources.push({ ...mapping, content, destination: `${mapping.version}_${mapping.name}.sql` });
  }
  const newPath = join(migrationRoot, sourceName);
  if ((await lstat(newPath)).isSymbolicLink()) throw new Error('Migration symlinks are forbidden');
  const content = await readFile(newPath, 'utf8');
  if (sourceName !== '20261002054701_running_core_v1.sql' || hash(content) !== '73ebeb3c43db5c8d0ba817a16420f92dead1d82a1a35286a2a22cd0125b7e7ac') throw new Error('Original running migration hash changed');
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
    format_version: 2,
    source_repository: 'cxr542/medical-briefing-bot',
    baseline_remote_head: '4fab8ecb1b5197f4d793510bad3b803927dfee0f',
    history_mapping: sources.map(({ content: ignored, ...item }) => item),
    new_migration: { source: sourceName, source_version: sourceName.slice(0,14), destination: newName, version: newVersion, sha256: hash(content) },
    production_approved: false,
    expected_pending_versions: [newVersion],
    history_evidence: 'Caller-supplied offline version/name snapshot; no remote connection',
    pending_verified: pending !== undefined,
    instructions: 'Local review artifact only. Deployment version is a bundle-only alias; original source and SQL are unchanged. Never replay history mirrors or repair history. Production approval and fresh pre-flight are required separately. No credentials or linked project configuration included.',
  };
  await writeFile(join(destination, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--output','--history','--pending','--deployment-version'].includes(args[index]) || !args[index + 1] || options.has(args[index])) throw new Error('Usage: --output NEW_DIRECTORY --history OFFLINE_JSON --deployment-version YYYYMMDDHHMMSS [--pending OFFLINE_JSON]');
    options.set(args[index], args[index + 1]);
  }
  if (!options.has('--output') || !options.has('--history')) throw new Error('--output and --history are required');
  const history = JSON.parse(await readFile(options.get('--history'), 'utf8'));
  const pending = options.has('--pending') ? JSON.parse(await readFile(options.get('--pending'), 'utf8')) : undefined;
  const manifest = await prepareBundle({ output: options.get('--output'), history, pending, deploymentVersion: options.get('--deployment-version') });
  console.log(JSON.stringify({ new_version: manifest.new_migration.version, pending_verified: manifest.pending_verified }));
}
