import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { REMEMBER_TTL, sessionCookie, CustomerAuthService } from '../src/lib/customer-auth/core.mjs';

const foundation = await readFile(new URL('../../../supabase/migrations/20261013043423_customer_auth_foundation.sql', import.meta.url),'utf8');
const migration = await readFile(new URL('../../../supabase/migrations/20261029093624_customer_remember_login.sql', import.meta.url),'utf8');
const user='11111111-1111-4111-8111-111111111111';
const admin='22222222-2222-4222-8222-222222222222';
const token='a'.repeat(64);
async function fixture(remember=true,kind='user') {
  const db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  await db.exec(foundation);
  await db.query("INSERT INTO customer_auth.customer_users(id,employee_number) VALUES ($1,'synthetic-user')",[user]);
  await db.query("INSERT INTO customer_auth.customer_admins(id,login_id,password_hash) VALUES ($1,'synthetic-admin','$argon2id$synthetic')",[admin]);
  await db.exec("INSERT INTO customer_auth.customer_credentials(kind,password_hash) VALUES ('shared','$argon2id$synthetic');");
  await db.exec(migration);
  const payload={kind,principal_id:kind==='user'?user:admin,token_hash:token,credential_version:1,principal_version:1,remember};
  await db.query(`SELECT public.${remember?'customer_session_rpc':'customer_auth_rpc'}('issue_session',$1::jsonb)`,[JSON.stringify(payload)]);
  return db;
}
async function refresh(db) {
  return db.transaction(async tx=>{
    await tx.exec('SET LOCAL ROLE service_role');
    const {rows}=await tx.query("SELECT public.customer_session_rpc('refresh_session',$1::jsonb) AS value",[JSON.stringify({kind:'user',token_hash:token})]);
    return rows[0].value;
  });
}
test('remembered login persists 30 days and renews from the latest visit',async()=>{
  // Given: a real issued remembered session last used two days ago.
  const db=await fixture();
  try {
    await db.exec("UPDATE customer_auth.customer_sessions SET issued_at=now()-interval '3 days',last_seen_at=now()-interval '2 days',expires_at=now()+interval '28 days'");
    // When: the authenticated browser refreshes.
    const result=await refresh(db);
    // Then: DB expiry moves to 30 days from this visit.
    assert.equal(result.id,user); assert.equal(result.remember,true);
    const {rows}=await db.query('SELECT extract(epoch FROM expires_at-now()) AS remaining FROM customer_auth.customer_sessions');
    assert.ok(Number(rows[0].remaining)>REMEMBER_TTL-5);
  } finally {await db.close();}
});
test('ordinary login remains fixed at eight hours after refresh',async()=>{
  // Given: an ordinary session.
  const db=await fixture(false);
  try {
    const before=(await db.query('SELECT expires_at FROM customer_auth.customer_sessions')).rows[0].expires_at;
    // When: the same refresh endpoint is called.
    const result=await refresh(db);
    // Then: it authorizes without extending the DB lifetime.
    assert.equal(result.remember,false);
    assert.deepEqual((await db.query('SELECT expires_at FROM customer_auth.customer_sessions')).rows[0].expires_at,before);
  } finally {await db.close();}
});
for(const [name,sql] of [
  ['expired',"UPDATE customer_auth.customer_sessions SET issued_at=now()-interval '40 days',last_seen_at=now()-interval '31 days',expires_at=now()-interval '1 day'"],
  ['logged out',"SELECT customer_auth.rpc('revoke_session',jsonb_build_object('kind','user','token_hash',repeat('a',64)))"],
  ['disabled',"UPDATE customer_auth.customer_users SET active=false"],
  ['password changed',"UPDATE customer_auth.customer_credentials SET password_hash='$argon2id$changed'"],
]) test(`remembered session cannot renew when ${name}`,async()=>{
  // Given: a remembered session invalidated by the named action.
  const db=await fixture();
  try {
    await db.exec(sql);
    // When: renewal is attempted.
    const result=await refresh(db);
    // Then: no principal is returned.
    assert.equal(result,null);
  } finally {await db.close();}
});
test('admin lifetime and server-only RPC grants remain restricted',async()=>{
  // Given: an ordinary administrator session.
  const db=await fixture(false,'admin');
  try {
    // When: asking to use the user renewal path and inspecting grants.
    assert.equal(await refresh(db),null);
    const {rows}=await db.query("SELECT extract(epoch FROM expires_at-issued_at) AS ttl FROM customer_auth.customer_sessions");
    // Then: admin stays at one hour and public roles cannot execute renewal.
    assert.equal(Number(rows[0].ttl),3600);
    for(const role of ['anon','authenticated']) {
      const r=await db.query("SELECT has_function_privilege($1,'public.customer_session_rpc(text,jsonb)','EXECUTE') AS allowed",[role]);
      assert.equal(r.rows[0].allowed,false);
    }
  } finally {await db.close();}
});
test('only user cookie can request 30 days and malformed lifetime is rejected',()=>{
  // Given: a synthetic cookie token.
  const raw='a'.repeat(43);
  // When: cookies are serialized for both roles.
  const remembered=sessionCookie('user',raw,true,false,REMEMBER_TTL);
  // Then: host-only secure cookie lasts 30 days, administrator cannot opt in.
  assert.match(remembered,/Max-Age=2592000; HttpOnly; SameSite=Lax; Secure$/);
  assert.throws(()=>sessionCookie('admin',raw,true,false,REMEMBER_TTL));
  assert.throws(()=>sessionCookie('user',raw,true,false,NaN));
});
test('login service ignores remember for administrators',async()=>{
  // Given: a synthetic repository and a real password hash.
  const { hashPassword }=await import('../src/lib/customer-auth/core.mjs');
  const password_hash=await hashPassword('synthetic-password'); let issued;
  const service=new CustomerAuthService({async call(operation,payload){
    if(operation==='consume_attempt')return {allowed:true};
    if(operation==='lookup_admin')return {id:admin,active:true,password_hash,session_version:1,credential_version:1};
    if(operation==='issue_session'){issued=payload;return {ok:true};}
    throw new Error(operation);
  }});
  // When: an administrator submits remember=true.
  const result=await service.login('admin','synthetic-admin','synthetic-password',{ip:'test',identity:'test'},true);
  // Then: issuance stays ordinary.
  assert.equal(result.status,200); assert.equal(issued.remember,false);
});
