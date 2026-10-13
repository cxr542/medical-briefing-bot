// Run against an explicitly started loopback build with Foundation disabled.
import assert from 'node:assert/strict';
import test from 'node:test';
const base=process.env.CUSTOMER_AUTH_TEST_ORIGIN;
if (!base || new URL(base).hostname!=='127.0.0.1' || new URL(base).protocol!=='http:') throw new Error('Explicit loopback test origin required');
const request=(path,init)=>fetch(base+path,init);
const productionCookie='__Host-medical_customer_session='+'a'.repeat(43);
await test('unauthenticated and cross-role APIs fail before DB access',async()=>{
 for(const route of ['/api/customer-auth/session','/api/customer-admin/session','/api/admin/monitoring'])assert.equal((await request(route)).status,401);
 assert.equal((await request('/api/customer-admin/session',{headers:{cookie:productionCookie}})).status,403);
 assert.equal((await request('/api/admin/monitoring',{headers:{cookie:'__Host-medical_customer_admin_session='+'a'.repeat(43)}})).status,401);
});
await test('disabled login fails closed; CSRF and malformed input rejected',async()=>{
 for(const prefix of ['customer-auth','customer-admin']) {
  const route='/api/'+prefix+'/login';
  assert.equal((await request(route,{method:'POST',headers:{'content-type':'application/json'},body:'{}'})).status,403);
  const host=new URL(base).host;
  const headers={'content-type':'application/json',origin:'https://'+host};
  const r=await request(route,{method:'POST',headers,body:JSON.stringify({identifier:'synthetic-only',password:'synthetic-password-only'})});
  assert.equal(r.status,503); assert.match(r.headers.get('cache-control'),/no-store/);
  assert.equal((await r.text()).includes('password_hash'),false);
  assert.equal((await request(route,{method:'POST',headers,body:'['})).status,400);
  assert.equal((await request(route,{method:'POST',headers,body:JSON.stringify({password:'x'.repeat(5000)})})).status,400);
 }
});
await test('anonymous logout clears secure cookie; disabled session never accepts forged cookie',async()=>{
 const headers={origin:'https://'+new URL(base).host};
 const response=await request('/api/customer-auth/logout',{method:'POST',headers});
 assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/Max-Age=0; HttpOnly; SameSite=Lax; Secure/);
 assert.equal((await request('/api/customer-auth/session',{headers:{cookie:productionCookie}})).status,503);
});
await test('customer-admin has server login guard while medical deep link remains open',async()=>{
 const r=await fetch(base+'/customer-admin',{redirect:'manual'});assert.equal(r.status,307);
 assert.equal(new URL(r.headers.get('location'),base).pathname,'/customer-admin/login');
 const login=await request('/customer-admin/login');assert.equal(login.status,200);assert.match(await login.text(),/고객 관리자 로그인/);
 assert.equal((await request('/neurology-dashboard')).status,200);
});
