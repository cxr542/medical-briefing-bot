import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { usageQuery } from '../src/lib/customer-usage/contract.ts';

const user='11111111-1111-4111-8111-111111111111';
const admin='22222222-2222-4222-8222-222222222222';
const userHash='a'.repeat(64), adminHash='b'.repeat(64);
export async function fixture() {
  const db=new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  for(const name of ['20261013043423_customer_auth_foundation','20261013050900_customer_admin_management','20261029093624_customer_remember_login','20261030010818_customer_usage'])
    await db.exec(await readFile(new URL(`../../../supabase/migrations/${name}.sql`,import.meta.url),'utf8'));
  await db.query("INSERT INTO customer_auth.customer_users(id,employee_number) VALUES ($1,'00001')",[user]);
  await db.query("INSERT INTO customer_auth.customer_admins(id,login_id,password_hash) VALUES ($1,'synthetic-admin','$argon2id$synthetic')",[admin]);
  await db.exec("INSERT INTO customer_auth.customer_credentials(kind,password_hash) VALUES ('shared','$argon2id$synthetic');");
  return db;
}
async function rpc(db,fn,operation,payload) {
  return db.transaction(async tx=>{
    await tx.exec('SET LOCAL ROLE service_role');
    return (await tx.query(`SELECT public.${fn}($1,$2::jsonb) AS value`,[operation,JSON.stringify(payload)])).rows[0].value;
  });
}
const issue=(db,kind='user',remember=false,token_hash=userHash)=>rpc(db,remember?'customer_session_rpc':'customer_auth_rpc','issue_session',{
  kind,remember,token_hash,principal_id:kind==='user'?user:admin,credential_version:1,principal_version:1,
});
const refresh=db=>rpc(db,'customer_usage_rpc','refresh_session',{kind:'user',token_hash:userHash});
const list=(db,query={})=>rpc(db,'customer_usage_rpc','list',{admin_token_hash:adminHash,from:'2026-10-01',to:'2026-10-31',group:'day',search:'',page:1,...query});

test('successful ordinary and remembered issuance count logins; repeated refresh counts one access day',async()=>{
  // Given: both session policies for one ID.
  const db=await fixture();
  try {
    await issue(db); await issue(db,'user',true,'c'.repeat(64));
    // When: repeated and concurrent visible checks refresh either policy.
    await Promise.all([refresh(db),refresh(db),rpc(db,'customer_usage_rpc','refresh_session',{kind:'user',token_hash:'c'.repeat(64)})]);
    // Then: one calendar-day row, two logins and valid sessions.
    const {rows}=await db.query("SELECT *,activity_date=(now() AT TIME ZONE 'Asia/Seoul')::date AS correct_day FROM customer_auth.customer_usage_daily");
    assert.equal(rows.length,1);assert.equal(Number(rows[0].login_count),2);assert.equal(rows[0].correct_day,true);
    assert.equal((await refresh(db)).id,user);
  } finally {await db.close();}
});
for(const [name,sql] of [
  ['revoked',"UPDATE customer_auth.customer_sessions SET revoked_at=now()"],
  ['disabled',"UPDATE customer_auth.customer_users SET active=false"],
  ['credential rotation',"UPDATE customer_auth.customer_credentials SET password_hash='$argon2id$changed'"],
  ['expired',"UPDATE customer_auth.customer_sessions SET issued_at=now()-interval '9 hours',expires_at=now()-interval '1 hour'"],
])test(`invalid ${name} sessions cannot add usage or renew`,async()=>{
  // Given: a previously issued, then invalidated session without usage rows.
  const db=await fixture();
  try {
    await issue(db);await db.exec('DELETE FROM customer_auth.customer_usage_daily');await db.exec(sql);
    // When: activity renewal is requested.
    const result=await refresh(db);
    // Then: authorization fails and no activity is recorded.
    assert.equal(result,null);assert.equal((await db.query('SELECT count(*) AS n FROM customer_auth.customer_usage_daily')).rows[0].n,0);
  } finally {await db.close();}
});
test('admin login and read-only validation do not record user activity',async()=>{
  // Given: an administrator and a user session.
  const db=await fixture();
  try {
    await issue(db);await db.exec('DELETE FROM customer_auth.customer_usage_daily');
    // When: admin signs in and hidden/read-only user validation runs.
    await issue(db,'admin',false,adminHash);
    await rpc(db,'customer_auth_rpc','validate_session',{kind:'user',token_hash:userHash});
    // Then: neither produces user usage.
    assert.equal((await db.query('SELECT count(*) AS n FROM customer_auth.customer_usage_daily')).rows[0].n,0);
  } finally {await db.close();}
});
test('range totals, KST midnight dates, weekly/monthly buckets and inactive or unused IDs are preserved',async()=>{
  // Given: KST midnight on a month and week boundary, plus an unused ID.
  const db=await fixture();
  try {
    await issue(db,'admin',false,adminHash);
    await db.exec("INSERT INTO customer_auth.customer_users(employee_number,active) VALUES ('00002',false)");
    for(const [at,n] of [['2026-09-30T14:59:59Z',1],['2026-09-30T15:00:00Z',2],['2026-10-04T15:00:00Z',3]])
      await db.query("INSERT INTO customer_auth.customer_usage_daily VALUES ($1,($2::timestamptz AT TIME ZONE 'Asia/Seoul')::date,$2,$3)",[user,at,n]);
    // When: each grouping queries only October.
    const day=await list(db),week=await list(db,{group:'week'}),month=await list(db,{group:'month'});
    // Then: pre-range activity is excluded; week/month starts retain selected-date totals.
    assert.equal(day.users[0].access_days,2);assert.equal(day.users[0].login_count,5);
    assert.deepEqual(day.users[0].periods.map(p=>p.period),['2026-10-05','2026-10-01']);
    assert.deepEqual(week.users[0].periods.map(p=>p.period),['2026-10-05','2026-09-28']);
    assert.equal(month.users[0].periods[0].login_count,5);
    assert.equal(day.users[1].active,false);assert.equal(day.users[1].access_days,0);assert.equal(day.users[1].last_seen_at,null);
    assert.ok(day.started_at);
  } finally {await db.close();}
});
test('usage query requires a customer admin and public roles have no read or execute privilege',async()=>{
  // Given: a general user and server/public role boundaries.
  const db=await fixture();
  try {
    await issue(db);
    // When: a general token requests listing, or public roles request table/RPC access.
    await assert.rejects(list(db,{admin_token_hash:userHash}),/Admin required/);
    for(const role of ['anon','authenticated']) {
      const row=(await db.query("SELECT has_function_privilege($1,'public.customer_usage_rpc(text,jsonb)','EXECUTE') AS execute,has_table_privilege($1,'customer_auth.customer_usage_daily','SELECT') AS read",[role])).rows[0];
      // Then: neither boundary permits a usage read.
      assert.equal(row.execute,false);assert.equal(row.read,false);
    }
  } finally {await db.close();}
});
test('literal search, pagination and SQL date-range validation cannot bypass query bounds',async()=>{
  // Given: more than one page and an ID containing a wildcard character.
  const db=await fixture();
  try {
    await issue(db,'admin',false,adminHash);
    await db.exec("INSERT INTO customer_auth.customer_users(employee_number) SELECT 'id-'||n FROM generate_series(1,23) n; INSERT INTO customer_auth.customer_users(employee_number) VALUES ('literal%id');");
    // When: reading pages, literal search, and invalid ranges.
    const first=await list(db),second=await list(db,{page:2}),literal=await list(db,{search:'%'});
    // Then: pages are disjoint, search is literal and malformed bounds fail.
    assert.equal(first.users.length,20);assert.equal(second.users.length,5);
    assert.equal(new Set([...first.users,...second.users].map(u=>u.id)).size,25);
    assert.equal(literal.total,1);assert.equal(literal.users[0].employee_number,'literal%id');
    await assert.rejects(list(db,{from:'2026-10-31',to:'2026-10-01'}),/Invalid usage range/);
    await assert.rejects(list(db,{from:'2020-01-01'}),/Invalid usage range/);
    await assert.rejects(list(db,{group:'year'}),/Invalid usage range/);
  } finally {await db.close();}
});
test('HTTP query parser rejects impossible dates and unbounded ranges',()=>{
  // Given: untrusted URL parameters.
  const base={from:'2026-10-01',to:'2026-10-31'};
  // When/Then: parse rejects invalid calendar dates, grouping, bounds and pages.
  for(const value of [{...base,from:'2026-02-30'},{...base,from:'2020-01-01'},{...base,group:'year'},{...base,page:'0'}])
    assert.equal(usageQuery.safeParse(value).success,false);
  assert.equal(usageQuery.safeParse(base).success,true);
});

test('duplicate or stale session issuance cannot increment the login aggregate',async()=>{
  // Given: one successful session issuance and its aggregate.
  const db=await fixture();
  try {
    await issue(db);
    // When: its insertion is retried, then a stale credential tries issuance.
    await assert.rejects(issue(db),/duplicate key/);
    const stale=await rpc(db,'customer_auth_rpc','issue_session',{kind:'user',principal_id:user,token_hash:'d'.repeat(64),credential_version:99,principal_version:1});
    // Then: both attempts preserve the one successful login.
    assert.equal(stale.ok,false);
    assert.equal(Number((await db.query('SELECT login_count FROM customer_auth.customer_usage_daily')).rows[0].login_count),1);
  } finally {await db.close();}
});
