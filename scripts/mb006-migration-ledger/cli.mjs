import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runMigration } from './engine.mjs';
import { provision, cleanup } from './local.mjs';
import { LedgerError } from './manifest.mjs';

export async function main(args) {
  const options = new Map();
  for (let index = 0; index < args.length; index += 2) {
    if (!['--mode','--descriptor','--version'].includes(args[index]) || !args[index + 1] || options.has(args[index])) {
      throw new LedgerError('ONLY_LOCAL_DESCRIPTOR_MODE_VERSION_ACCEPTED');
    }
    options.set(args[index], args[index + 1]);
  }
  const mode = options.get('--mode') || 'validate';
  if (!['validate','apply','provision','cleanup'].includes(mode)) throw new LedgerError('INVALID_MODE');
  if (mode === 'provision') {
    if (options.size !== 1) throw new LedgerError('PROVISION_ACCEPTS_NO_TARGET_ARGUMENTS');
    return provision();
  }
  const descriptor = options.get('--descriptor');
  if (!descriptor || descriptor.includes('://') || descriptor.includes('kkcvglldsoxglfjqnsga')) throw new LedgerError('LOCAL_DESCRIPTOR_REQUIRED');
  if (mode === 'cleanup') {
    if (options.has('--version')) throw new LedgerError('CLEANUP_ACCEPTS_NO_VERSION');
    return cleanup(descriptor);
  }
  return runMigration({ descriptor, version: options.get('--version'), mode });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)))); }
  catch (error) {
    console.error(JSON.stringify({ result: 'REJECTED_OR_FAILED', code: error instanceof LedgerError ? error.code : 'LOCAL_VALIDATION_FAILED' }));
    process.exitCode = 1;
  }
}
