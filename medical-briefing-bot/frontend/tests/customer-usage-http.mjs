import assert from 'node:assert/strict';
import { before,after,test } from 'node:test';
import { startUsageServer } from './fixtures/usageServer.mjs';
let server;
before(async()=>{server=await startUsageServer();});
after(async()=>{await server?.stop();});
const range='from=2026-01-01&to=2026-12-31&group=day';
async function login(kind='customer-admin',remember=false) {
  const response=await server.call(`/api/${kind}/login`,{identifier:kind==='customer-admin'?'synthetic-admin':'test-001',password:server.password,remember});
  assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];
}
test('usage API and page deny anonymous and user sessions',async()=>{
  // Given: no admin session.
  const cookie=await login('customer-auth');
  // When: anonymous and general-user reads reach real Next routes.
  const anonymous=await server.call(`/api/customer-admin/usage?${range}`);
  const user=await server.call(`/api/customer-admin/usage?${range}`,undefined,cookie);
  const page=await fetch(server.origin+'/customer-admin/usage',{redirect:'manual'});
  // Then: reads fail and the page redirects to admin login.
  assert.equal(anonymous.status,401);assert.equal(user.status,403);assert.equal(page.status,307);
  assert.equal(page.headers.get('location'),'/customer-admin/login');
});
test('admin sees both login policies and activity persists across checks without duplicate days',async()=>{
  // Given: successful ordinary and remembered login for the same ID.
  const ordinary=await login('customer-auth'),remembered=await login('customer-auth',true),admin=await login();
  // When: hidden validation, visible renewal and admin usage reads execute against real SQL.
  const before=(await server.db.query('SELECT sum(login_count) AS n FROM customer_auth.customer_usage_daily')).rows[0].n;
  assert.equal((await server.call('/api/customer-auth/session',undefined,ordinary)).status,200);
  for(const cookie of [ordinary,remembered])assert.equal((await server.call('/api/customer-auth/session',undefined,cookie,'POST')).status,200);
  const result=await server.call(`/api/customer-admin/usage?${range}`,undefined,admin);
  // Then: admin gets sanitized totals and pagination with one daily record.
  assert.equal(result.status,200);assert.match(result.headers.get('cache-control'),/no-store/);
  const data=await result.json();assert.equal(data.total,24);assert.equal(data.users.length,20);
  assert.equal(data.users[0].login_count,Number(before));assert.equal(data.users[0].access_days,1);
  assert.equal(Object.keys(data.users[0]).includes('token_hash'),false);
  const next=await server.call(`/api/customer-admin/usage?${range}&page=2`,undefined,admin);
  assert.equal((await next.json()).users.length,4);
  assert.equal((await server.call(`/api/customer-admin/usage?${range}&search=not-found`,undefined,admin)).status,200);
  assert.equal((await server.call('/customer-admin/usage',undefined,admin)).status,200);
});
test('API rejects invalid date ranges and database failures stay sanitized',async()=>{
  // Given: a valid admin.
  const admin=await login();
  // When: malformed parameters or unavailable storage reach the route.
  const bad=await server.call('/api/customer-admin/usage?from=2026-02-30&to=2026-10-30',undefined,admin);
  server.setStoreAvailable(false);
  const unavailable=await server.call(`/api/customer-admin/usage?${range}`,undefined,admin);
  server.setStoreAvailable(true);
  // Then: input failure and store failure differ without exposing internals.
  assert.equal(bad.status,400);assert.equal(unavailable.status,503);
  assert.doesNotMatch(await unavailable.text(),/Synthetic|customer_auth|token_hash/);
});
test('failed password and logout cannot add usage',async()=>{
  // Given: an ordinary valid user session and its current daily totals.
  const cookie=await login('customer-auth');
  const before=(await server.db.query('SELECT sum(login_count) AS n FROM customer_auth.customer_usage_daily')).rows[0].n;
  // When: failed login and post-logout session refreshes are submitted.
  assert.equal((await server.call('/api/customer-auth/login',{identifier:'test-001',password:'wrong-password'})).status,401);
  assert.equal((await server.call('/api/customer-auth/logout',{},cookie)).status,200);
  assert.equal((await server.call('/api/customer-auth/session',undefined,cookie,'POST')).status,401);
  // Then: only the already successful login remains counted.
  assert.equal((await server.db.query('SELECT sum(login_count) AS n FROM customer_auth.customer_usage_daily')).rows[0].n,before);
});
