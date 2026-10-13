// Isolated real PostgreSQL -> local PostgREST-compatible transport -> real Next handlers/UI.
import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync,spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { hashPassword } from '../../medical-briefing-bot/frontend/src/lib/customer-auth/core.mjs';
const container=process.env.CUSTOMER_AUTH_TEST_CONTAINER;
if(!container||!/^customer-auth-foundation-[a-z0-9-]+$/.test(container))throw new Error('Explicit disposable container required');
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
function docker(args,input){const r=spawnSync('/usr/local/bin/docker',['--host=unix:///var/run/docker.sock',...args],{input,encoding:'utf8',env});if(r.status!==0){const error=new Error('Isolated SQL failure');error.code=r.stderr.match(/ERROR:\s+([0-9A-Z]{5}):/)?.[1]||'P0001';throw error;}return r.stdout.trim();}
const info=JSON.parse(docker(['inspect',container]))[0];assert.equal(info.HostConfig.NetworkMode,'none');assert.equal(info.HostConfig.Privileged,false);assert.ok(info.Config.Image.startsWith('postgres:'));
const sql=query=>docker(['exec','-i',container,'psql','-X','-qAt','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres'],query);
const quote=v=>"'"+String(v).replaceAll("'","''")+"'";
assert.equal(sql("SELECT count(*) FROM pg_tables WHERE schemaname='public';"),'0');
sql('CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role BYPASSRLS;CREATE TABLE public.articles(id integer);INSERT INTO public.articles VALUES(42);ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;CREATE POLICY "누구나 기사 읽기 가능" ON public.articles FOR SELECT USING(true);GRANT ALL ON public.articles TO anon,authenticated,service_role;');
for(const file of ['20261013043423_customer_auth_foundation.sql','20261013050900_customer_admin_management.sql'])sql(await readFile(new URL('../migrations/'+file,import.meta.url),'utf8'));
const shared=await hashPassword('synthetic-shared-only'),adminHash=await hashPassword('synthetic-admin-only');
sql(`INSERT INTO customer_auth.customer_users(employee_number) SELECT 'E-'||lpad(i::text,3,'0') FROM generate_series(1,20) i;INSERT INTO customer_auth.customer_credentials(kind,password_hash) VALUES('shared',${quote(shared)});INSERT INTO customer_auth.customer_admins(login_id,password_hash) VALUES('fixture-admin',${quote(adminHash)});`);
let app,transport,browser;let origin,adminCookie,userCookie,secondUserCookie;let calls=0;
async function cleanup(){await browser?.close();app?.kill('SIGTERM');if(app&&app.exitCode===null)await Promise.race([once(app,'exit'),delay(3000)]);if(app?.exitCode===null)app.kill('SIGKILL');if(transport){transport.closeAllConnections();await new Promise(resolve=>transport.close(resolve));}}
transport=createServer(async(req,res)=>{
 if(req.url?.startsWith('/rest/v1/articles')){res.setHeader('content-type','application/json');const date=new Date();date.setHours(date.getHours()-24);const rows=Array.from({length:12},(_,i)=>({id:i+1,source:'대한병원협회 공지사항',title:'Synthetic article '+(i+1),url:'https://example.com/article/'+(i+1),published_date:date.toISOString(),created_at:date.toISOString(),status:'NEW',category:'공지',keywords:'synthetic',private_fixture:'must-not-serialize'}));res.end(JSON.stringify(rows));return;}
 const functionName=req.url==='/rest/v1/rpc/customer_auth_rpc'?'customer_auth_rpc':req.url==='/rest/v1/rpc/customer_admin_rpc'?'customer_admin_rpc':null;
 if(!functionName||req.headers.apikey!=='isolated-fake-service-role'){res.writeHead(403).end();return;}
 let input='';for await(const chunk of req)input+=chunk;
 const {operation,payload}=JSON.parse(input);calls++;
 try{const result=sql(`SET ROLE service_role;SELECT public.${functionName}(${quote(operation)},${quote(JSON.stringify(payload))}::jsonb);`);res.setHeader('content-type','application/json');res.end(result||'null');}
 catch(e){res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({code:e.code,message:'Isolated operation rejected'}));}
});transport.listen(0,'127.0.0.1');await once(transport,'listening');
const reserve=createServer();reserve.listen(0,'127.0.0.1');await once(reserve,'listening');const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));origin=`http://127.0.0.1:${port}`;
const frontend=fileURLToPath(new URL('../../medical-briefing-bot/frontend/',import.meta.url));
const appEnv={...process.env,NODE_ENV:'development',CUSTOMER_AUTH_FOUNDATION_ENABLED:'true',CUSTOMER_AUTH_ENFORCEMENT_ENABLED:'true',CUSTOMER_AUTH_RATE_LIMIT_SECRET:'isolated-test-only-rate-secret-00000',NEXT_PUBLIC_SUPABASE_URL:`http://127.0.0.1:${transport.address().port}`,NEXT_PUBLIC_SUPABASE_ANON_KEY:'isolated-fake-anon',SUPABASE_SERVICE_ROLE_KEY:'isolated-fake-service-role'};
delete appEnv.ADMIN_PASSWORD;delete appEnv.CRON_SECRET;delete appEnv.GITHUB_DISPATCH_TOKEN;
app=spawn(process.execPath,[frontend+'node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{cwd:frontend,env:appEnv,stdio:['ignore','pipe','pipe']});app.stdout.resume();app.stderr.resume();
let ready=false;for(let i=0;i<150;i++){if(app.exitCode!==null)throw new Error('Isolated Next startup failed');try{if((await fetch(origin+'/api/customer-admin/session')).status===401){ready=true;break;}}catch{}await delay(200);}assert.ok(ready);
const req=(path,method='GET',body,cookie=adminCookie,originHeader=origin)=>fetch(origin+path,{method,headers:{...(cookie?{cookie}:{}),...(method!=='GET'?{origin:originHeader,'content-type':'application/json'}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
const login=async(kind,id,password)=>{const r=await req(`/api/${kind==='user'?'customer-auth':'customer-admin'}/login`,'POST',{identifier:id,password},null);assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
await test('anonymous/role matrix and server page guard deny before database access',async()=>{
 const before=calls;assert.equal((await req('/api/customer-admin/users','GET',undefined,null)).status,401);assert.equal(calls,before);
 const page=await fetch(origin+'/customer-admin',{redirect:'manual'});assert.equal(page.status,307);assert.equal(new URL(page.headers.get('location'),origin).pathname,'/customer-admin/login');
 adminCookie=await login('admin','fixture-admin','synthetic-admin-only');userCookie=await login('user','E-001','synthetic-shared-only');secondUserCookie=await login('user','E-002','synthetic-shared-only');
 assert.equal((await req('/api/customer-admin/users','GET',undefined,userCookie)).status,403);
 assert.equal((await req('/api/customer-admin/users','GET',undefined,'medical_briefing_admin_session=synthetic-only')).status,403);
 assert.equal((await req('/api/admin/monitoring','GET',undefined,adminCookie)).status,401);
 assert.equal((await req('/api/cron/collector-dispatch','GET',undefined,null)).status,405);
 assert.equal((await req('/api/cron/collector-dispatch','POST',{},adminCookie)).status,503);
});
await test('list/search/status/pagination/stats and safe public DTOs',async()=>{
 const r=await req('/api/customer-admin/users');assert.equal(r.status,200,await r.clone().text());const data=await r.json();assert.equal(data.users.length,10);assert.equal(data.stats.total,20);assert.equal(data.stats.active,20);assert.equal(data.total,20);
 assert.equal((await (await req('/api/customer-admin/users?page=2')).json()).users.length,10);
 assert.equal((await (await req('/api/customer-admin/users?search=E-001')).json()).total,1);
 assert.equal((await (await req('/api/customer-admin/users?search=%25')).json()).total,0);
 assert.equal((await req('/api/customer-admin/users?page_size=51')).status,400);
 for(const value of ['password_hash','credential_version','token_hash','session_version','isolated-fake-service-role'])assert.equal(JSON.stringify(data).includes(value),false);
 assert.equal((await req('/api/customer-admin/users','POST',{employee_number:'blocked'},adminCookie,'https://evil.invalid')).status,403);
});
await test('add/leading zero/duplicates and atomic bulk rollback',async()=>{
 assert.equal((await req('/api/customer-admin/users','POST',{employee_number:'001025'})).status,201);
 assert.equal((await req('/api/customer-admin/users','POST',{employee_number:'X'.repeat(64)})).status,201);
 assert.equal((await req('/api/customer-admin/users','POST',{employee_number:'001025'})).status,409);
 assert.equal((await req('/api/customer-admin/users','POST',{employee_number:'bad value'})).status,400);
 assert.equal((await req('/api/customer-admin/users/bulk','POST',{employee_numbers:'bulk-1,bulk-2'})).status,201);
 assert.equal((await req('/api/customer-admin/users/bulk','POST',{employee_numbers:['must-rollback','001025']})).status,409);
 assert.equal(sql("SELECT count(*) FROM customer_auth.customer_users WHERE employee_number='must-rollback';"),'0');
 assert.equal((await req('/api/customer-admin/users/bulk','POST',{employee_numbers:['same','same']})).status,409);
 assert.equal((await req('/api/customer-admin/users/bulk','POST',{employee_numbers:['good','bad value']})).status,400);
 assert.equal((await req('/api/customer-admin/users/bulk','POST',{employee_numbers:Array.from({length:101},(_,i)=>'limit-'+i)})).status,400);
});
await test('disable/reactivate invalidates copied user sessions and records audit',async()=>{
 const id=(await(await req('/api/customer-admin/users?search=E-001')).json()).users[0].id;
 assert.equal((await req(`/api/customer-admin/users/${id}/status`,'PATCH',{active:false})).status,200);
 assert.equal((await req('/api/customer-auth/session','GET',undefined,userCookie)).status,401);assert.equal((await req('/api/customer-auth/session','GET',undefined,secondUserCookie)).status,200);
 assert.equal((await req(`/api/customer-admin/users/${id}/status`,'PATCH',{active:true})).status,200);
 assert.equal((await req('/api/customer-auth/session','GET',undefined,userCookie)).status,401);
 assert.equal((await req('/api/customer-admin/users?status=inactive')).status,200);
 assert.equal((await req('/api/customer-admin/users/00000000-0000-0000-0000-000000000099/status','PATCH',{active:true})).status,404);
 userCookie=await login('user','E-001','synthetic-shared-only');
});
await test('shared password requires admin reauthentication; rotation preserves admin but rejects users',async()=>{
 assert.equal((await req('/api/customer-admin/shared-password','POST',{password:'synthetic-new-shared',confirmation:'synthetic-new-shared',admin_password:'wrong'})).status,403);
 assert.equal((await req('/api/customer-admin/shared-password','POST',{password:'synthetic-new-shared',confirmation:'mismatch',admin_password:'synthetic-admin-only'})).status,400);
 const r=await req('/api/customer-admin/shared-password','POST',{password:'synthetic-new-shared',confirmation:'synthetic-new-shared',admin_password:'synthetic-admin-only'});assert.equal(r.status,200);assert.deepEqual(await r.json(),{ok:true});
 assert.equal((await req('/api/customer-auth/session','GET',undefined,userCookie)).status,401);assert.equal((await req('/api/customer-auth/session','GET',undefined,secondUserCookie)).status,401);assert.equal((await req('/api/customer-admin/session')).status,200);
 const auditResponse=await req('/api/customer-admin/audit');assert.equal(auditResponse.status,200,await auditResponse.clone().text());const audits=await auditResponse.json();assert.ok(audits.events.some(e=>e.action==='shared_password_changed'));
 assert.equal(JSON.stringify(audits).includes('password_hash'),false);assert.equal((await req('/api/customer-admin/audit?page=1&page_size=2')).status,200);
 assert.equal(sql("SELECT count(*) FROM public.articles;"),'1');assert.equal(sql("SELECT has_function_privilege('anon','public.customer_admin_rpc(text,jsonb)','EXECUTE');"),'f');
});
await test('general protected pages/API, role boundaries and late article lockdown',async()=>{
 for(const path of ['/','/neurology-dashboard']) {
  const r=await fetch(origin+path,{redirect:'manual'});assert.equal(r.status,307);
  assert.equal(new URL(r.headers.get('location'),origin).pathname,'/login');
 }
 for(const path of ['/api/articles','/api/collection-status']) {
  assert.equal((await req(path,'GET',undefined,null)).status,401);
  assert.equal((await req(path,'GET',undefined,adminCookie)).status,401);
 }
 sql("UPDATE customer_auth.customer_users SET active=false WHERE employee_number='E-004';");
 const failures=[];
 for(const [identifier,password] of [['unknown-fixture','synthetic-new-shared'],['E-004','synthetic-new-shared'],['E-005','wrong-fixture']]) {
  const rejected=await req('/api/customer-auth/login','POST',{identifier,password},null);assert.equal(rejected.status,401);failures.push(await rejected.json());
 }
 assert.deepEqual(failures[0],failures[1]);assert.deepEqual(failures[1],failures[2]);
 assert.equal((await req('/api/articles','GET',undefined,userCookie)).status,401);
 const cookie=await login('user','E-003','synthetic-new-shared');
 const article=await req('/api/articles?date=2026-10-13&time=15:07','GET',undefined,cookie);assert.equal(article.status,200);assert.match(article.headers.get('cache-control'),/no-store/);
 assert.equal((await req('/neurology-dashboard','GET',undefined,cookie)).status,200);
 assert.equal((await req('/api/articles?date=bad&time=bad','GET',undefined,cookie)).status,400);
 assert.equal((await req('/api/admin/monitoring','GET',undefined,cookie)).status,401);
 assert.equal((await req('/api/customer-auth/logout','POST',{},cookie)).status,200);
 assert.equal((await req('/api/articles','GET',undefined,cookie)).status,401);
 assert.equal((await req('/api/cron/collector-dispatch','GET',undefined,null)).headers.get('location'),null);
 sql(await readFile(new URL('../migrations/20261013062556_article_application_only.sql',import.meta.url),'utf8'));
 sql(await readFile(new URL('../migrations/20261013062556_article_application_only.sql',import.meta.url),'utf8'));
 for(const role of ['anon','authenticated']){assert.equal(sql(`SELECT has_table_privilege('${role}','public.articles','SELECT');`),'f');assert.throws(()=>sql(`SET ROLE ${role};SELECT * FROM public.articles;`));}
 assert.equal(sql("SELECT has_table_privilege('service_role','public.articles','SELECT,INSERT,UPDATE,DELETE');"),'t');
 assert.equal(sql('SET ROLE service_role;SELECT count(*) FROM public.articles;'),'1');
});
if(process.env.CUSTOMER_ADMIN_PLAYWRIGHT_PATH){
 await test('browser 375/768/1440 login/search/add/bulk/status/password/audit/refresh/focus/logout',async()=>{
  const {chromium}=await import(process.env.CUSTOMER_ADMIN_PLAYWRIGHT_PATH);browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});const context=await browser.newContext();const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin+'/customer-admin');await page.getByLabel('관리자 ID',{exact:true}).fill('fixture-admin');await page.getByLabel('관리자 비밀번호',{exact:true}).fill('synthetic-admin-only');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.getByRole('heading',{name:'고객 계정 관리',exact:true}).waitFor();await page.getByRole('button',{name:'사번 추가',exact:true}).waitFor();
  await mkdir('/workspace/artifacts/customer-admin-integration',{recursive:true});
  for(const width of [375,768,1440]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:`/workspace/artifacts/customer-admin-integration/${width}.png`,fullPage:true});await page.getByRole('button',{name:'사번 추가',exact:true}).click();const d=page.getByRole('dialog');await d.waitFor();const box=await d.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width&&box.y>=0&&box.y+box.height<=1000);assert.equal(await page.evaluate(()=>document.activeElement.tagName),'INPUT');for(let i=0;i<8;i++)await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.querySelector('dialog').contains(document.activeElement)),true);await page.keyboard.press('Escape');assert.equal(await d.count(),0);assert.equal(await page.getByRole('button',{name:'사번 추가',exact:true}).evaluate(e=>e===document.activeElement),true);}
  await page.getByRole('textbox',{name:'사번 검색'}).fill('E-001');await page.getByRole('button',{name:'사번 E-001 관리'}).waitFor();await page.getByRole('button',{name:'사번 E-001 관리'}).click();await page.getByRole('button',{name:'비활성화',exact:true}).click();await page.getByRole('button',{name:'사번 E-001 관리'}).click();await page.getByRole('button',{name:'다시 활성화',exact:true}).click();
  await page.getByRole('textbox',{name:'사번 검색'}).fill('');await page.getByRole('button',{name:'사번 추가',exact:true}).click();await page.getByRole('textbox',{name:'사번',exact:true}).fill('ui-0001');await page.getByRole('dialog').getByRole('button',{name:'사번 추가',exact:true}).click();await page.getByRole('button',{name:'사번 ui-0001 관리'}).waitFor();const addedUser=await login('user','ui-0001','synthetic-new-shared');assert.equal((await req('/api/articles?date=2026-10-13&time=15:07','GET',undefined,addedUser)).status,200);await page.reload();await page.getByRole('button',{name:'사번 ui-0001 관리'}).waitFor();
  await page.getByRole('button',{name:'일괄 등록',exact:true}).click();await page.getByRole('textbox',{name:'등록할 사번'}).fill('ui-0002,ui-0003');await page.getByRole('button',{name:'2명 등록',exact:true}).click();await page.getByRole('button',{name:'사번 ui-0003 관리'}).waitFor();
  await page.getByRole('button',{name:'다음 페이지',exact:true}).click();await page.getByText(/전체 .*명 중 11–/).waitFor();
  await page.getByRole('button',{name:'공용 비밀번호 변경',exact:true}).click();await page.getByLabel('새 비밀번호',{exact:true}).fill('synthetic-ui-shared');await page.getByLabel('새 비밀번호 확인',{exact:true}).fill('synthetic-ui-shared');await page.getByLabel('현재 관리자 비밀번호',{exact:true}).fill('synthetic-admin-only');await page.getByRole('button',{name:'비밀번호 변경',exact:true}).click();await page.getByRole('status').filter({hasText:'공용 비밀번호를 변경했습니다.'}).waitFor();
  await page.getByRole('button',{name:'전체보기',exact:true}).click();await page.getByRole('heading',{name:'전체 관리 이력',exact:true}).waitFor();await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.getByRole('heading',{name:'고객 관리자 로그인',exact:true}).waitFor();assert.deepEqual(errors,[]);
 });
}
if(process.env.CUSTOMER_ADMIN_PLAYWRIGHT_PATH)await test('general browser login/deep link/refresh/search/logout/back/expiry at three widths',async()=>{
 const failed=[];
 for(const width of [375,768,1440]) {
  const employee={375:'ui-0001',768:'ui-0002',1440:'ui-0003'}[width];
  const context=await browser.newContext({viewport:{width,height:1000}});const page=await context.newPage();
  page.on('pageerror',e=>failed.push(e.message));page.on('request',r=>{if(r.url().includes('/rest/v1/articles'))failed.push('Direct browser DB query');});
  await page.goto(origin+'/neurology-dashboard');assert.match(page.url(),/login\?next=/);
  await page.getByLabel('사번',{exact:true}).fill(employee);await page.getByLabel('공용 비밀번호').fill('synthetic-ui-shared');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.waitForURL('**/neurology-dashboard');await page.reload();await page.getByRole('button',{name:'로그아웃',exact:true}).waitFor();
  await page.goto(origin+'/');await page.getByText('Synthetic article 1',{exact:true}).first().waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal((await page.content()).includes('must-not-serialize'),false);
  const notices=page.locator('section').filter({has:page.getByRole('heading',{name:/7일 이내 주요 공지/})});
  await notices.locator('button').last().click();await page.getByText('Synthetic article 6',{exact:true}).waitFor();

  await page.getByPlaceholder('기사 제목, 키워드 검색...').fill('Synthetic');await page.waitForResponse(r=>r.url().includes('/api/articles?')&&r.url().includes('search=Synthetic'));
  await page.getByText('Synthetic article 1',{exact:true}).first().waitFor();
  await context.route('https://example.com/**',route=>route.fulfill({body:'Synthetic external article'}));
  const opened=context.waitForEvent('page');await page.locator('a[href="https://example.com/article/1"]').first().click();const articlePage=await opened;await articlePage.waitForURL('https://example.com/article/1');await articlePage.close();
  await page.getByRole('button',{name:'로그아웃',exact:true}).click();await page.waitForURL('**/login');await page.goBack();await page.waitForURL('**/login**');
  assert.equal(await page.getByText('Synthetic article 1',{exact:true}).count(),0);
  await page.getByLabel('사번',{exact:true}).fill(employee);await page.getByLabel('공용 비밀번호').fill('synthetic-ui-shared');await page.getByRole('button',{name:'로그인',exact:true}).click();await page.waitForURL('**/');
  sql("UPDATE customer_auth.customer_sessions SET issued_at=now()-interval '9 hours',expires_at=now()-interval '1 hour' WHERE kind='user';");await page.reload();await page.waitForURL('**/login**');
  await context.close();
 }
 assert.deepEqual(failed,[]);
});
await test('admin expiry/tampering/logout/copied revoked token and reauth cooldown',async()=>{
 assert.equal((await req('/api/customer-admin/users','GET',undefined,adminCookie.slice(0,-1)+(adminCookie.endsWith('A')?'B':'A'))).status,401);
 const limited=await login('admin','fixture-admin','synthetic-admin-only');
 for(let i=0;i<5;i++)await req('/api/customer-admin/shared-password','POST',{password:'synthetic-extra-shared',confirmation:'synthetic-extra-shared',admin_password:'wrong'},limited);
 assert.equal((await req('/api/customer-admin/shared-password','POST',{password:'synthetic-extra-shared',confirmation:'synthetic-extra-shared',admin_password:'synthetic-admin-only'},limited)).status,429);
 assert.equal((await req('/api/customer-admin/logout','POST',{},limited)).status,200);assert.equal((await req('/api/customer-admin/users','GET',undefined,limited)).status,401);
 sql("UPDATE customer_auth.customer_sessions SET issued_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' WHERE kind='admin';");assert.equal((await req('/api/customer-admin/users')).status,401);
 const r=await fetch(origin+'/customer-admin',{headers:{cookie:adminCookie},redirect:'manual'});assert.equal(r.status,307);assert.equal(new URL(r.headers.get('location'),origin).pathname,'/customer-admin/login');
});

await cleanup();
