import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { ADMIN_A, authFoundation, migration } from './fixtures/supportDatabase.mjs';

// Own container only: no host port, network, external URL, secret or persistent volume.
const execute = promisify(execFile);
const container = `support-rollback-${randomUUID()}`;
const rollback = await readFile(new URL('../../supabase/rollback/support_foundation_empty_only.sql', import.meta.url), 'utf8');
const insert = `INSERT INTO support.support_requests(title,description,requester_admin_id)
  VALUES ('Concurrent request','Must survive removal','${ADMIN_A}');`;
const args = database => ['exec', '-i', container, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', database];
const query = async (database, sql) => (await execute('docker', [...args(database), '-c', sql], { timeout: 15000 })).stdout.trim();

before(async () => {
  await execute('docker', ['run', '--detach', '--rm', '--network', 'none', '--name', container,
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17.6-alpine'], { timeout: 120000 });
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      await execute('docker', ['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres']);
      return;
    } catch (error) {
      if (attempt === 99) throw error;
      await delay(100);
    }
  }
});
after(async () => { await execute('docker', ['rm', '--force', container]); });

let databaseNumber = 0;
async function fixture() {
  const database = `rollback_${++databaseNumber}`;
  await query('postgres', `CREATE DATABASE ${database}`);
  // Roles are cluster-wide; each fixture uses a separate database.
  const auth = databaseNumber === 1 ? authFoundation : authFoundation.replace(
    'CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;', '');
  await query(database, auth);
  await query(database, `INSERT INTO customer_auth.customer_admins(id) VALUES ('${ADMIN_A}')`);
  await query(database, migration);
  return database;
}

// Keep a real psql connection open across barriers, without timing-based ordering.
function session(database) {
  const child = spawn('docker', args(database), { stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '';
  let errors = '';
  let pending;
  let markerNumber = 0;
  child.stdout.on('data', chunk => {
    output += chunk;
    if (pending && output.includes(pending.marker)) {
      clearTimeout(pending.timer);
      pending.resolve();
      pending = undefined;
      output = '';
    }
  });
  child.stderr.on('data', chunk => { errors += chunk; });
  const closed = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', code => {
      if (pending) {
        clearTimeout(pending.timer);
        pending.reject(new Error(errors || `psql exited ${code}`));
        pending = undefined;
      }
      resolve();
    });
  });
  return {
    run(sql) {
      assert.equal(pending, undefined);
      return new Promise((resolve, reject) => {
        const marker = `barrier_${++markerNumber}`;
        const timer = setTimeout(() => { reject(new Error(`psql barrier timed out: ${errors}`)); child.kill(); }, 10000);
        pending = { marker, timer, resolve, reject };
        child.stdin.write(`${sql}\n\\echo ${marker}\n`);
      });
    },
    async close() { child.stdin.end(); await closed; },
  };
}

async function assertPreserved(database) {
  assert.equal(await query(database, 'SELECT count(*) FROM support.support_requests'), '1');
  assert.equal(await query(database, "SELECT to_regprocedure('public.customer_support_rpc(text,jsonb)') IS NOT NULL"), 't');
  assert.equal(await query(database, 'SELECT count(*) FROM customer_auth.customer_admins'), '1');
}

test('native empty rollback drops support and preserves existing authentication', async () => {
  const database = await fixture();
  await query(database, rollback);
  assert.equal(await query(database, "SELECT to_regnamespace('support') IS NULL"), 't');
  assert.equal(await query(database, 'SELECT count(*) FROM customer_auth.customer_admins'), '1');
});

test('native populated rollback refuses and preserves rows and RPCs', async () => {
  const database = await fixture();
  await query(database, insert);
  await assert.rejects(query(database, rollback), error => /Support contains data/.test(error.stderr));
  await assertPreserved(database);
});

test('in-flight INSERT makes rollback fail closed before its empty check', async () => {
  const database = await fixture();
  const writer = session(database);
  try {
    await writer.run(`BEGIN; ${insert}`);
    await assert.rejects(query(database, rollback), error => /55P03/.test(error.stderr));
    await writer.run('COMMIT;');
    await assertPreserved(database);
    await assert.rejects(query(database, rollback), error => /Support contains data/.test(error.stderr));
    await assertPreserved(database);
  } finally { await writer.close(); }
});

test('INSERT cannot commit between the real rollback empty check and DROP', async () => {
  const database = await fixture();
  const remover = session(database);
  // Execute the actual script up to its first DROP, pausing in that transaction.
  const dropOffset = rollback.indexOf('DROP FUNCTION');
  assert.ok(dropOffset > 0);
  try {
    await remover.run(rollback.slice(0, dropOffset));
    await assert.rejects(query(database, `BEGIN; SET LOCAL lock_timeout='300ms'; ${insert} COMMIT;`), error => /55P03/.test(error.stderr));
    await remover.run(rollback.slice(dropOffset));
    assert.equal(await query(database, "SELECT to_regnamespace('support') IS NULL"), 't');
    assert.equal(await query(database, 'SELECT count(*) FROM customer_auth.customer_admins'), '1');
  } finally { await remover.close(); }
});
