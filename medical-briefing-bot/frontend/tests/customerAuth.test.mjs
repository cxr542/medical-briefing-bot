import assert from 'node:assert/strict';
import test from 'node:test';
import { CustomerAuthService, hashPassword, verifyPassword, sessionCookie, readSessionCookie, tokenHash, rateKeys, LOGIN_FAILURE } from '../src/lib/customer-auth/core.mjs';
import { isAdminRequestAuthorized } from '../src/lib/adminAuth.mjs';

const shared = await hashPassword('synthetic-shared-only');
const admin = await hashPassword('synthetic-admin-only');
function fixture() {
  const users = { '000employee': { id: 'user-a', active: true, session_version: 1, credential_version: 1, password_hash: shared }, inactive: { id: 'user-b', active: false, session_version: 1, credential_version: 1, password_hash: shared } };
  const admins = { primary: { id: 'admin-a', active: true, session_version: 1, credential_version: 1, password_hash: admin } };
  const sessions = new Map(); const attempts = new Map(); const calls = [];
  const repository = { async call(operation, p) {
    calls.push({ operation, payload: p });
    if (operation === 'consume_attempt') { const count = (attempts.get(p.identity) || 0) + 1; attempts.set(p.identity, count); return { allowed: count <= 5 }; }
    if (operation === 'lookup_user') return users[p.identifier] || null;
    if (operation === 'lookup_admin') return admins[p.identifier] || null;
    if (operation === 'issue_session') {
      const principal = Object.values(p.kind === 'user' ? users : admins).find(value => value.id === p.principal_id);
      if (!principal?.active || principal.session_version !== p.principal_version || principal.credential_version !== p.credential_version) return { ok: false };
      sessions.set(p.token_hash, { ...p, expires: Date.now() + 100000 }); return { ok: true };
    }
    if (operation === 'validate_session') {
      const s = sessions.get(p.token_hash); const principal = s && Object.values(p.kind === 'user' ? users : admins).find(value => value.id === s.principal_id);
      return s?.kind === p.kind && s.expires > Date.now() && principal?.active && principal.session_version === s.principal_version && principal.credential_version === s.credential_version ? { id: principal.id } : null;
    }
    if (operation === 'revoke_session') { sessions.delete(p.token_hash); return { ok: true }; }
    if (operation === 'audit_admin_failure') return { ok: true };
    throw new Error('Unexpected operation');
  } };
  return { service: new CustomerAuthService(repository), repository, users, sessions, calls };
}
const keys = { ip: 'fixture-ip', identity: 'fixture-id' };

test('active registered employee succeeds; wrong, absent and inactive cases have generic identical failure', async () => {
  const f = fixture(); const ok = await f.service.login('user','000employee','synthetic-shared-only',keys);
  assert.equal(ok.status,200); assert.deepEqual(ok.principal,{id:'user-a',kind:'user'});
  assert.equal(JSON.stringify(ok).includes('password_hash'),false);
  const results = [];
  for (const [id,password] of [['000employee','wrong'],['absent','synthetic-shared-only'],['inactive','synthetic-shared-only']]) results.push(await fixture().service.login('user',id,password,keys));
  results.forEach(result=>assert.deepEqual(result,{status:401,error:LOGIN_FAILURE}));
  assert.ok(f.sessions.has(tokenHash(ok.token))); assert.equal(f.calls.some(call=>JSON.stringify(call.payload).includes('synthetic-shared-only')),false);
});

test('session expiration, tampering, logout and cross-role cookies are denied', async () => {
  const f=fixture(); const result=await f.service.login('user','000employee','synthetic-shared-only',keys);
  assert.ok(await f.service.authorize('user',result.token));
  assert.equal(await f.service.authorize('admin',result.token),null);
  assert.equal(await f.service.authorize('user',result.token.slice(0,-1)+(result.token.endsWith('A')?'B':'A')),null);
  f.sessions.get(tokenHash(result.token)).expires=0; assert.equal(await f.service.authorize('user',result.token),null);
  const second=await f.service.login('user','000employee','synthetic-shared-only',keys); await f.service.logout('user',second.token); assert.equal(await f.service.authorize('user',second.token),null);
});

test('shared rotation and user disable/version changes invalidate previous sessions', async () => {
  for(const change of [u=>u.active=false,u=>u.session_version++,u=>u.credential_version++]) {
    const f=fixture(); const result=await f.service.login('user','000employee','synthetic-shared-only',keys); change(f.users['000employee']); assert.equal(await f.service.authorize('user',result.token),null);
  }
});

test('credential changed during verification cannot issue a stale session', async () => {
  const f=fixture(); const call=f.repository.call.bind(f.repository);
  f.repository.call=async(op,p)=>{if(op==='issue_session')f.users['000employee'].credential_version++;return call(op,p)};
  assert.equal((await f.service.login('user','000employee','synthetic-shared-only',keys)).status,401);
});

test('separate admin password and durable repository admission prevent role escalation and brute force', async () => {
  const f=fixture(); assert.equal((await f.service.login('admin','primary','synthetic-shared-only',keys)).status,401);
  const result=await f.service.login('admin','primary','synthetic-admin-only',keys); assert.equal(result.status,200);
  assert.equal(await f.service.authorize('user',result.token),null);
  assert.equal(isAdminRequestAuthorized(new Request('https://example.invalid/api/admin/monitoring',{headers:{cookie:sessionCookie('admin',result.token,true)}})),false);
  await assert.rejects(()=>f.service.setUserActive('invalid','user-a',false),/Unauthorized/);
  for(let i=0;i<3;i++)await f.service.login('user','absent','bad',keys);
  assert.equal((await f.service.login('user','absent','bad',keys)).status,429);
});

test('Argon2id uses random salt and rejects corrupt or excessive-cost hashes', async () => {
  const second=await hashPassword('synthetic-shared-only'); assert.notEqual(shared,second);
  assert.match(shared,/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
  assert.equal(await verifyPassword(shared,'synthetic-shared-only'),true);
  assert.equal(await verifyPassword(shared.replace('m=19456','m=999999999'),'synthetic-shared-only'),false);
  await assert.rejects(()=>hashPassword('short'));
});

test('cookies are HttpOnly, secure host-only in production; duplicate and malformed cookies rejected', () => {
  const token='a'.repeat(43); const cookie=sessionCookie('user',token,true);
  assert.match(cookie,/^__Host-medical_customer_session=/); assert.match(cookie,/HttpOnly; SameSite=Lax; Secure$/); assert.doesNotMatch(cookie,/Domain=/);
  const req=value=>new Request('https://example.invalid',{headers:{cookie:value}});
  assert.equal(readSessionCookie(req(cookie),'user',true),token);
  assert.equal(readSessionCookie(req(`${cookie}; __Host-medical_customer_session=${token}`),'user',true),null);
  assert.equal(readSessionCookie(req('medical_customer_admin_session='+token),'user',false),null);
  assert.match(sessionCookie('user','',true,true),/Max-Age=0/);
  assert.notEqual(rateKeys('user','id','127.0.0.1','s'.repeat(32)).identity,rateKeys('admin','id','127.0.0.1','s'.repeat(32)).identity);
});
