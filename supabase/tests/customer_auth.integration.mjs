// Opt-in disposable local PostgreSQL verification. Never connects to a Supabase project.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { CustomerAuthService, hashPassword, tokenHash } from '../../medical-briefing-bot/frontend/src/lib/customer-auth/core.mjs';
const container=process.env.CUSTOMER_AUTH_TEST_CONTAINER;
if (!container || !/^customer-auth-foundation-[a-z0-9-]+$/.test(container)) throw new Error('An explicitly named disposable customer-auth-foundation container is required');
const dockerArgs=['--host=unix:///var/run/docker.sock'];
const cleanEnv={...process.env}; for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete cleanEnv[key];
function docker(args,input) { const r=spawnSync('/usr/local/bin/docker',[...dockerArgs,...args],{input,encoding:'utf8',env:cleanEnv}); if(r.status!==0)throw new Error(`Disposable Docker/SQL operation failed: ${r.stderr}`);return r.stdout.trim(); }
const info=JSON.parse(docker(['inspect',container]))[0];
assert.equal(info.HostConfig.NetworkMode,'none'); assert.equal(info.HostConfig.Privileged,false); assert.ok(info.Config.Image.startsWith('postgres:'));
const sql=query=>docker(['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres'],query);
assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';"),'0','fresh empty disposable DB only');
sql("CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE public.articles(id integer PRIMARY KEY); INSERT INTO public.articles VALUES(42);");
const before=sql("SELECT row_to_json(t) FROM (SELECT * FROM public.articles) t;");
sql(await readFile(new URL('../migrations/20261013043423_customer_auth_foundation.sql',import.meta.url),'utf8'));
assert.equal(sql("SELECT row_to_json(t) FROM (SELECT * FROM public.articles) t;"),before);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
const shared=await hashPassword('synthetic-shared-only'); const adminHash=await hashPassword('synthetic-admin-only');
sql(`INSERT INTO customer_auth.customer_users(id,employee_number) VALUES('00000000-0000-0000-0000-000000000001','000employee'); INSERT INTO customer_auth.customer_credentials(kind,password_hash) VALUES('shared',${quote(shared)}); INSERT INTO customer_auth.customer_admins(id,login_id,password_hash) VALUES('00000000-0000-0000-0000-000000000002','primary',${quote(adminHash)});`);
const repository={async call(op,p){ const result=sql(`SET ROLE service_role; SELECT public.customer_auth_rpc(${quote(op)},${quote(JSON.stringify(p))}::jsonb);`);return result?JSON.parse(result):null; }};
const service=new CustomerAuthService(repository); let counter=0;
const login=(kind,id,password)=>service.login(kind,id,password,{ip:(++counter).toString(16).padStart(64,'0'),identity:counter.toString(16).padStart(64,'0')});
let userToken; let adminToken;
await test('migration restricts anon/authenticated and preserves medical baseline',()=>{
 for(const role of ['anon','authenticated']) {
  assert.equal(sql(`SELECT has_schema_privilege(${quote(role)},'customer_auth','USAGE');`),'f');
  assert.equal(sql(`SELECT has_function_privilege(${quote(role)},'public.customer_auth_rpc(text,jsonb)','EXECUTE');`),'f');
 }
 assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='customer_auth' AND rowsecurity;"),'6');
 assert.equal(sql("SELECT has_table_privilege('service_role','customer_auth.customer_audit_logs','UPDATE');"),'f');
});
await test('actual SQL RPC supports registered login and denies wrong/absent/inactive credentials',async()=>{
 const result=await login('user','000employee','synthetic-shared-only'); assert.equal(result.status,200); userToken=result.token;
 assert.equal((await login('user','000employee','wrong')).status,401);
 assert.equal((await login('user','absent','synthetic-shared-only')).status,401);
 const a=await login('admin','primary','synthetic-admin-only');assert.equal(a.status,200);adminToken=a.token;
 assert.equal(await service.authorize('admin',userToken),null); assert.equal(await service.authorize('user',adminToken),null);
 assert.equal(JSON.stringify(await service.authorize('user',userToken)).includes('password_hash'),false);
});
await test('rotation atomically invalidates user sessions but preserves separate admin',async()=>{
 await service.changeSharedPassword(adminToken,'synthetic-new-shared');assert.equal(await service.authorize('user',userToken),null);
 assert.ok(await service.authorize('admin',adminToken));
 assert.equal((await login('user','000employee','synthetic-shared-only')).status,401);
 const next=await login('user','000employee','synthetic-new-shared');assert.equal(next.status,200);userToken=next.token;
 assert.equal(sql("SELECT credential_version FROM customer_auth.customer_credentials WHERE kind='shared';"),'2');
});
await test('disable/re-enable never revives old sessions; unauthorized mutations fail',async()=>{
 await service.setUserActive(adminToken,'00000000-0000-0000-0000-000000000001',false);
 assert.equal(await service.authorize('user',userToken),null);assert.equal((await login('user','000employee','synthetic-new-shared')).status,401);
 await service.setUserActive(adminToken,'00000000-0000-0000-0000-000000000001',true);
 assert.equal(await service.authorize('user',userToken),null);
 assert.throws(()=>sql(`SET ROLE service_role; SELECT public.customer_auth_rpc('rotate_shared',${quote(JSON.stringify({admin_token_hash:tokenHash(userToken),password_hash:shared}))}::jsonb);`));
});
await test('actual SQL session expiry/logout, stale issuance and audit records',async()=>{
 const result=await login('user','000employee','synthetic-new-shared');assert.equal(result.status,200);
 await service.logout('user',result.token);assert.equal(await service.authorize('user',result.token),null);
 const old={kind:'user',principal_id:'00000000-0000-0000-0000-000000000001',token_hash:'f'.repeat(64),credential_version:1,principal_version:1};assert.equal((await repository.call('issue_session',old)).ok,false);
 sql(`UPDATE customer_auth.customer_sessions SET issued_at=now()-interval '9 hours',expires_at=now()-interval '1 hour' WHERE token_hash=${quote(tokenHash(userToken))};`);
 assert.equal(await service.authorize('user',userToken),null);
 assert.equal(sql("SELECT count(*) FROM customer_auth.customer_audit_logs WHERE action IN ('shared_password_changed','employee_disabled','employee_activated');"),'3');
});
await test('atomic durable rate limit survives a second service instance',async()=>{
 const keys={ip:'d'.repeat(64),identity:'e'.repeat(64)};
 for(let i=0;i<5;i++)assert.equal((await new CustomerAuthService(repository).login('user','absent','bad',keys)).status,401);
 assert.equal((await new CustomerAuthService(repository).login('user','absent','bad',keys)).status,429);
});
