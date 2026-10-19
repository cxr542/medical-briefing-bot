import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { readFile, appendFile, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { DATABASE, LedgerError } from './manifest.mjs';

export function docker(args, input = '', timeout = 20000) {
  return new Promise((resolve, reject) => {
    const child = execFile('docker', ['--host', `unix://${homedir()}/.docker/run/docker.sock`, ...args], {
      env: { PATH: process.env.PATH, HOME: homedir() }, timeout, maxBuffer: 4 * 1024 * 1024,
    }, (error, stdout) => error ? reject(new LedgerError('LOCAL_DOCKER_COMMAND_FAILED')) : resolve(stdout.trim()));
    child.stdin.on('error', () => reject(new LedgerError('LOCAL_DOCKER_INPUT_FAILED')));
    child.stdin.end(input);
  });
}

export async function readTarget(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o077)) throw new LedgerError('UNSAFE_DESCRIPTOR_FILE');
  let target;
  try { target = JSON.parse(await readFile(path, 'utf8')); }
  catch { throw new LedgerError('INVALID_LOCAL_DESCRIPTOR'); }
  const fields = ['kind', 'container', 'name', 'image', 'nonce', 'system', 'database', 'oid'];
  if (!target || typeof target !== 'object' || Object.keys(target).sort().join() !== fields.sort().join() || target.kind !== 'mb006-local-only-v1'
    || !/^[a-f0-9]{64}$/.test(target.container) || !/^sha256:[a-f0-9]{64}$/.test(target.image)
    || !/^[a-f0-9]{32}$/.test(target.nonce) || target.name !== `mb006-ledger-${target.nonce}`
    || !/^\d+$/.test(target.system) || !/^\d+$/.test(String(target.oid)) || target.database !== DATABASE) {
    throw new LedgerError('INVALID_LOCAL_DESCRIPTOR');
  }
  return { ...target, descriptor: path };
}

export async function sql(target, query) {
  return docker(['exec', '-i', target.container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-h', '/var/run/postgresql', '-p', '5432', '-U', 'postgres', '-d', DATABASE], query);
}

export async function proveIsolation(target) {
  const [container] = JSON.parse(await docker(['inspect', target.container]));
  if (container.Id !== target.container || container.Name !== '/' + target.name || !container.State.Running
    || container.Image !== target.image || container.Config.Labels?.['mb006.atomic.nonce'] !== target.nonce
    || container.HostConfig.NetworkMode !== 'none' || Object.keys(container.HostConfig.PortBindings || {}).length
    || Object.keys(container.NetworkSettings.Ports || {}).some(port => container.NetworkSettings.Ports[port] !== null)
    || (container.HostConfig.Binds || []).length || container.Mounts.some(mount => mount.Type !== 'volume')) {
    throw new LedgerError('ISOLATION_PROOF_FAILED');
  }
  const identity = JSON.parse(await sql(target, `SELECT jsonb_build_object(
    'database',current_database(),'oid',(SELECT oid FROM pg_database WHERE datname=current_database()),
    'system',(SELECT system_identifier::text FROM pg_control_system()),'version',current_setting('server_version_num'),
    'address',inet_server_addr(),'listen',current_setting('listen_addresses'),'port',current_setting('port'),
    'nonce',(SELECT nonce FROM mb006_ledger_guard.identity));`));
  if (identity.database !== DATABASE || String(identity.oid) !== String(target.oid) || identity.system !== target.system
    || identity.nonce !== target.nonce || !/^17\d{4}$/.test(identity.version) || identity.address !== null || identity.listen !== '' || identity.port !== '5432') {
    throw new LedgerError('SERVER_IDENTITY_MISMATCH');
  }
  return { container: container.Id, host: 'container-local-unix-socket', port: Number(identity.port), database: DATABASE,
    system: identity.system, oid: identity.oid, version: identity.version, network: 'none', project: 'synthetic-local-only' };
}

export async function audit(target, record) {
  await appendFile(join(dirname(target.descriptor), 'audit.jsonl'), JSON.stringify({ at: new Date().toISOString(), ...record }) + '\n', { mode: 0o600 });
}
