import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createDatabase, rpc, create, TOKEN_A, TOKEN_B, ADMIN_A } from './fixtures/supportDatabase.mjs';
import { tokenHash, cookieName } from '../src/lib/customer-auth/core.mjs';

const CUSTOMER = '/api/customer-admin/support/requests';
const INTERNAL = '/api/admin/support/requests';
const TEST_PASSWORD = 'local-only-support-admin-password-123456';
const TEST_KEY = 'local-only-support-service-key';
const cookieA = `${cookieName('admin', true)}=${TOKEN_A}`;
const cookieB = `${cookieName('admin', true)}=${TOKEN_B}`;
const ordinary = `${cookieName('user', true)}=${'u'.repeat(43)}`;
let db, databaseServer, app, origin, databaseOrigin, internalCookie;
let databaseFailure = false;

async function listen(server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

async function stopApp() {
  if (app && app.exitCode === null) {
    const ended = once(app, 'exit');
    app.kill('SIGTERM');
    await ended;
  }
}

async function startApp(support = 'true', foundation = 'true', enforcement = 'false') {
  await stopApp();
  const reservation = createServer();
  origin = await listen(reservation);
  const port = new URL(origin).port;
  await new Promise(resolve => reservation.close(resolve));
  app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', port], {
    cwd: new URL('..', import.meta.url), stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production', SUPPORT_ENABLED: support,
      CUSTOMER_AUTH_FOUNDATION_ENABLED: foundation, CUSTOMER_AUTH_ENFORCEMENT_ENABLED: enforcement,
      NEXT_PUBLIC_SUPABASE_URL: databaseOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-only-anon',
      SUPABASE_SERVICE_ROLE_KEY: TEST_KEY, ADMIN_PASSWORD: TEST_PASSWORD },
  });
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (app.exitCode !== null) throw new Error('Local Next application exited');
    try {
      if ((await fetch(origin + CUSTOMER)).status === 401) return;
    } catch (error) { if (!(error instanceof TypeError)) throw error; }
    await delay(100);
  }
  throw new Error('Local Next readiness deadline exceeded');
}

async function call(path, { cookie, method = 'GET', body, requestOrigin = origin.replace('http:', 'https:'), headers = {} } = {}) {
  const response = await fetch(origin + path, { method, headers: {
    ...(cookie ? { cookie } : {}), ...(method !== 'GET' ? { Origin: requestOrigin, 'Content-Type': 'application/json' } : {}), ...headers,
  }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  return { status: response.status, data: await response.json() };
}

before(async () => {
  db = await createDatabase();
  databaseServer = createServer(async (request, response) => {
    response.setHeader('Content-Type', 'application/json');
    if (request.headers.apikey !== TEST_KEY) { response.writeHead(401).end('{}'); return; }
    if (databaseFailure) { response.writeHead(500).end(JSON.stringify({ code: 'XX000', message: 'PRIVATE_DATABASE_SENTINEL' })); return; }
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const { operation, payload } = JSON.parse(Buffer.concat(chunks).toString());
      let result;
      switch (request.url) {
        case '/rest/v1/rpc/customer_auth_rpc': {
          assert.equal(operation, 'validate_session');
          result = await db.transaction(async tx => {
            await tx.exec('SET LOCAL ROLE service_role');
            const { rows } = await tx.query('SELECT customer_auth.validate_session($1,$2) AS data', [payload.kind,payload.token_hash]);
            return rows[0].data;
          });
          break;
        }
        case '/rest/v1/rpc/customer_support_rpc': result = await rpc(db, 'customer', operation, payload); break;
        case '/rest/v1/rpc/admin_support_rpc': result = await rpc(db, 'internal', operation, payload); break;
        default: throw new Error('Unexpected database route');
      }
      response.end(JSON.stringify(result));
    } catch (error) {
      response.writeHead(400).end(JSON.stringify({ code: error.code || 'XX000', message: 'TEST_DATABASE_ERROR' }));
    }
  });
  databaseOrigin = await listen(databaseServer);
  const build = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'build'], {
    cwd: new URL('..', import.meta.url), stdio: 'inherit',
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: databaseOrigin, NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-only-anon' },
  });
  const [buildCode] = await once(build, 'exit');
  assert.equal(buildCode, 0, 'Local test build must succeed');
  await startApp();
  const login = await fetch(origin + '/api/admin/login', { method: 'POST', headers: { Origin: origin.replace('http:', 'https:'), 'Content-Type': 'application/json' }, body: JSON.stringify({ password: TEST_PASSWORD }) });
  assert.equal(login.status, 200);
  internalCookie = login.headers.get('set-cookie').split(';')[0];
});

after(async () => {
  await stopApp();
  if (databaseServer) await new Promise(resolve => databaseServer.close(resolve));
  await db?.close();
});

test('HTTP support requires its own auth even when general customer enforcement is false', async () => {
  for (const [path,cookie,expected] of [
    [CUSTOMER,undefined,401], [CUSTOMER,ordinary,403], [CUSTOMER,internalCookie,403],
    [INTERNAL,undefined,401], [INTERNAL,cookieA,403], [INTERNAL,ordinary,403],
    [CUSTOMER,`${cookieName('admin',true)}=${'z'.repeat(43)}`,401],
  ]) assert.equal((await call(path,{cookie})).status, expected);
});

test('HTTP rejects expired revoked inactive and password-rotated customer admin sessions', async () => {
  for (const [table,field,value,restore] of [
    ['customer_sessions','expires_at',"now()-interval '1 second'","now()+interval '1 hour'"],
    ['customer_sessions','revoked_at','now()','NULL'],
    ['customer_admins','active','false','true'],
    ['customer_admins','credential_version','2','1'],
  ]) {
    const predicate = table === 'customer_sessions' ? 'token_hash=$1' : 'id=$1';
    const key = table === 'customer_sessions' ? tokenHash(TOKEN_A) : ADMIN_A;
    await db.query(`UPDATE customer_auth.${table} SET ${field}=${value} WHERE ${predicate}`, [key]);
    try { assert.equal((await call(CUSTOMER,{cookie:cookieA})).status,401); }
    finally { await db.query(`UPDATE customer_auth.${table} SET ${field}=${restore} WHERE ${predicate}`, [key]); }
  }
});

test('HTTP creates lists and reads requests with ownership isolation and pagination', async () => {
  const created = await call(CUSTOMER, { cookie: cookieA, method: 'POST', body: { title: 'HTTP request', description: 'details' } });
  assert.equal(created.status,201);
  const id = created.data.request.id;
  assert.equal((await call(`${CUSTOMER}/${id}`,{cookie:cookieA})).status,200);
  assert.equal((await call(`${CUSTOMER}/${id}`,{cookie:cookieB})).status,404);
  assert.equal((await call(CUSTOMER,{cookie:cookieB})).data.total,0);
  const own = await call(`${CUSTOMER}?page=1&page_size=1`,{cookie:cookieA});
  assert.equal(own.data.requests.length,1);
  const empty = await call(`${CUSTOMER}?page=99999&page_size=1`,{cookie:cookieA});
  assert.deepEqual(empty.data.requests,[]);
  assert.equal((await call(INTERNAL,{cookie:internalCookie})).data.total,own.data.total);
});

test('HTTP rejects spoofed owners invalid payloads invalid IDs and CSRF', async () => {
  const good = { title: 'test', description: 'details' };
  for (const options of [
    { body: {...good,requester_admin_id:ADMIN_A},expected:400 },
    { body: {...good,title:''},expected:400 },
    { body: {...good,description:'a'.repeat(10001)},expected:400 },
    { body: good,requestOrigin:'https://attacker.invalid',expected:403 },
    { body: good,headers:{Origin:''},expected:403 },
    { body: good,headers:{'Content-Type':'text/plain'},expected:400 },
    { body: {...good,description:'a'.repeat(60000)},expected:400 },
  ]) assert.equal((await call(CUSTOMER,{cookie:cookieA,method:'POST',...options})).status,options.expected);
  for (const suffix of ['?page=0','?page_size=51','?page=1&page=2','?unknown=x','/not-a-uuid']) assert.equal((await call(CUSTOMER+suffix,{cookie:cookieA})).status,400);
});

test('HTTP separates public answers from internal notes and preserves text without HTML rendering', async () => {
  const { request } = await create(db);
  const note = await call(`${INTERNAL}/${request.id}/notes`,{cookie:internalCookie,method:'POST',body:{body:'PRIVATE_NOTE_SENTINEL',version:1}});
  assert.equal(note.status,201);
  const text = '<script>alert("xss")</script>';
  const answer = await call(`${INTERNAL}/${request.id}/comments`,{cookie:internalCookie,method:'POST',body:{body:text,version:2}});
  assert.equal(answer.status,201);
  const customer = await call(`${CUSTOMER}/${request.id}`,{cookie:cookieA});
  assert.equal(customer.data.comments[0].body,text);
  assert.equal(JSON.stringify(customer.data).includes('PRIVATE_NOTE_SENTINEL'),false);
  assert.deepEqual(Object.keys(customer.data).sort(),['comments','comments_total','page','page_size','request']);
  const internal = await call(`${INTERNAL}/${request.id}`,{cookie:internalCookie});
  assert.equal(internal.data.notes[0].body,'PRIVATE_NOTE_SENTINEL');
  assert.equal(internal.data.audit.length,3);
  const historyPage = await call(`${INTERNAL}/${request.id}?page=2&page_size=1`,{cookie:internalCookie});
  assert.equal(historyPage.data.audit.length,1);
  assert.equal(historyPage.data.audit_total,3);
  for (const endpoint of ['notes','comments','status']) {
    assert.equal((await call(`${INTERNAL}/${request.id}/${endpoint}`,{cookie:internalCookie,method:endpoint==='status'?'PATCH':'POST',requestOrigin:'https://attacker.invalid',body:{}})).status,403);
  }
});

test('HTTP concurrent status changes produce one success and one conflict with history', async () => {
  const { request } = await create(db);
  const results = await Promise.all(['reviewing','on_hold'].map(status => call(`${INTERNAL}/${request.id}/status`,{cookie:internalCookie,method:'PATCH',body:{status,reason:'triage',version:1}})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  const { data } = await call(`${INTERNAL}/${request.id}`,{cookie:internalCookie});
  assert.equal(data.request.version,2);
  assert.equal(data.history.length,2);
  assert.equal(data.audit.length,2);
});

test('HTTP database failures return generic errors without credentials or internal details', async () => {
  databaseFailure = true;
  try {
    const result = await call(INTERNAL,{cookie:internalCookie});
    assert.deepEqual(result,{status:503,data:{error:'SUPPORT_UNAVAILABLE'}});
  } finally { databaseFailure = false; }
});

test('HTTP disabled support still authenticates and does not change existing internal monitoring auth', async () => {
  await startApp('false');
  assert.equal((await call(CUSTOMER)).status,401);
  assert.equal((await call(CUSTOMER,{cookie:cookieA})).data.error,'SUPPORT_DISABLED');
  assert.equal((await call(INTERNAL,{cookie:internalCookie})).data.error,'SUPPORT_DISABLED');
  assert.equal((await fetch(origin+'/api/admin/monitoring')).status,401);
});

test('HTTP missing flag defaults disabled and missing auth foundation fails closed', async () => {
  await startApp('');
  assert.equal((await call(CUSTOMER,{cookie:cookieA})).data.error,'SUPPORT_DISABLED');
  await startApp('true','false');
  assert.equal((await call(CUSTOMER,{cookie:cookieA})).status,503);
  assert.equal((await call(CUSTOMER)).status,401);
});

test('existing customer login and account management HTTP regressions pass unchanged', async () => {
  await startApp('false','false','true');
  const childEnv = { ...process.env, CUSTOMER_AUTH_TEST_ORIGIN: origin };
  delete childEnv.NODE_TEST_CONTEXT;
  const regression = spawn(process.execPath,['--test','tests/test_customer_auth_http.mjs'],{
    cwd:new URL('../..',import.meta.url),stdio:'inherit',
    env:childEnv,
  });
  const [code] = await once(regression,'exit');
  assert.equal(code,0);
});
