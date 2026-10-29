import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { before, after, test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { hashPassword } from '../src/lib/customer-auth/core.mjs';

let db, wire, app;
const origin='http://127.0.0.1:3047';
const requestOrigin='https://127.0.0.1:3047';
async function call(path,body,cookie,method='POST') {
  return fetch(origin+path,{method,headers:{Origin:requestOrigin,'Content-Type':'application/json',...(cookie?{cookie}:{})},...(body?{body:JSON.stringify(body)}:{})});
}
before(async()=>{
  db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  for(const name of ['20261013043423_customer_auth_foundation','20261029093624_customer_remember_login']) {
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
  }
  await db.exec("INSERT INTO customer_auth.customer_users(employee_number) VALUES ('synthetic-http-user');");
  await db.query("INSERT INTO customer_auth.customer_credentials(kind,password_hash) VALUES ('shared',$1)",[await hashPassword('synthetic-http-password')]);
  wire=createServer(async(req,res)=>{
    const chunks=[]; for await(const chunk of req)chunks.push(chunk);
    res.setHeader('Content-Type','application/json');
    if(!['/rest/v1/rpc/customer_auth_rpc','/rest/v1/rpc/customer_session_rpc'].includes(req.url)){res.end('[]');return;}
    try {
      const body=JSON.parse(Buffer.concat(chunks).toString());
      const fn=req.url.endsWith('/customer_session_rpc')?'customer_session_rpc':'customer_auth_rpc';
      const result=await db.transaction(async tx=>{
        await tx.exec('SET LOCAL ROLE service_role');
        return tx.query(`SELECT public.${fn}($1,$2::jsonb) AS value`,[body.operation,JSON.stringify(body.payload)]);
      });
      res.end(JSON.stringify(result.rows[0].value));
    } catch {res.writeHead(500).end('{"message":"Synthetic auth store error"}');}
  });
  wire.listen(0,'127.0.0.1');await once(wire,'listening');
  app=spawn(process.execPath,['node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3047'],{stdio:'ignore',env:{...process.env,NODE_ENV:'production',CUSTOMER_AUTH_FOUNDATION_ENABLED:'true',CUSTOMER_AUTH_RATE_LIMIT_SECRET:'synthetic-rate-secret-for-local-tests-only',NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${wire.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-anon',SUPABASE_SERVICE_ROLE_KEY:'synthetic-server'}});
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{clearInterval(timer);reject(new Error('Next readiness timeout'));},30000);
    const timer=setInterval(async()=>{try{await fetch(origin+'/login');clearInterval(timer);clearTimeout(timeout);resolve();}catch{}},100);
  });
});
after(async()=>{if(app){app.kill();await once(app,'exit');}if(wire)await new Promise(resolve=>wire.close(resolve));if(db)await db.close();});

test('production HTTP login, renewal, expiry cookie and logout work through the real DB',async()=>{
  // Given: a registered user and an opted-in browser login.
  const login=await call('/api/customer-auth/login',{identifier:'synthetic-http-user',password:'synthetic-http-password',remember:true});
  assert.equal(login.status,200);
  const cookie=login.headers.get('set-cookie').split(';')[0];
  assert.match(login.headers.get('set-cookie'),/Max-Age=2592000/);
  // When: the browser returns and renews the session.
  const refreshed=await call('/api/customer-auth/session',undefined,cookie);
  // Then: authorization and persistent cookie are renewed together.
  assert.equal(refreshed.status,200);assert.match(refreshed.headers.get('set-cookie'),/Max-Age=259[12][0-9]{3}/);
  assert.equal((await call('/api/customer-auth/logout',undefined,cookie)).status,200);
  const revoked=await call('/api/customer-auth/session',undefined,cookie);
  assert.equal(revoked.status,401);assert.match(revoked.headers.get('set-cookie'),/Max-Age=0/);
});
test('ordinary login remains eight hours and renewal does not set another cookie',async()=>{
  // Given: a registered user without opt-in.
  const login=await call('/api/customer-auth/login',{identifier:'synthetic-http-user',password:'synthetic-http-password'});
  assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/Max-Age=28800/);
  // When: a normal session check uses the same renewal path.
  const response=await call('/api/customer-auth/session',undefined,login.headers.get('set-cookie').split(';')[0]);
  // Then: it stays authorized without extending its cookie.
  assert.equal(response.status,200);assert.equal(response.headers.get('set-cookie'),null);
});
test('renewal rejects cross-origin requests and login rejects non-boolean opt-in',async()=>{
  // Given: no credential is needed to test boundary rejection.
  // When: malformed opt-in and foreign-origin renewal are submitted.
  const malformed=await call('/api/customer-auth/login',{remember:'true'});
  const foreign=await fetch(origin+'/api/customer-auth/session',{method:'POST',headers:{Origin:'https://foreign.invalid'}});
  // Then: both are rejected before issuance or renewal.
  assert.equal(malformed.status,400);assert.equal(foreign.status,403);
});
