import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const contractRoot = resolve(process.env.RUNNING_CONTRACT_ROOT ?? fileURLToPath(new URL('../../../today-shoes/', import.meta.url)));
const { parseWorkoutImportV1 } = await import(pathToFileURL(join(contractRoot, 'src/import/workoutContractV1.ts')));

const base = new URL(process.env.RUNNING_LOCAL_URL ?? 'http://127.0.0.1:54321');
if (base.protocol !== 'http:' || !['127.0.0.1','localhost','[::1]'].includes(base.hostname) || base.pathname !== '/' || base.username || base.password || base.search || base.hash) {
  throw new Error('Only a local disposable Supabase HTTP endpoint is accepted');
}
const anon = process.env.RUNNING_LOCAL_ANON_KEY;
const service = process.env.RUNNING_LOCAL_SERVICE_KEY;
if (!anon || !service) throw new Error('Local anon/service test credentials are required; Production credentials are forbidden');

async function request({ path, token = anon, key = anon, schema, method = 'GET', body, prefer = 'return=representation' }) {
  const headers = { apikey: key, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: prefer };
  if (schema) {
    headers['Accept-Profile'] = schema;
    headers['Content-Profile'] = schema;
  }
  const response = await fetch(new URL(path,base), {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  return { status: response.status, body: raw ? JSON.parse(raw) : null };
}
const rest = options => request({ ...options, path: `/rest/v1/${options.path}`, schema: options.schema ?? 'running' });
const denied = result => {
  assert.ok([401,403].includes(result.status), `Expected permission denial, got HTTP ${result.status}`);
  assert.equal(result.body?.code, '42501');
};

test('local running JWT isolation and medical service regression', async t => {
  const identities = [];
  t.after(async () => {
    for (const id of identities) {
      const result = await request({ path: `/auth/v1/admin/users/${id}`, key: service, token: service, method: 'DELETE' });
      assert.ok(result.status >= 200 && result.status < 300, 'Synthetic user cleanup failed');
    }
  });
  async function user() {
    const email = `running-test-${randomUUID()}@example.invalid`;
    const password = randomUUID();
    const created = await request({ path: '/auth/v1/admin/users', key: service, token: service, method: 'POST', body: { email, password, email_confirm: true } });
    assert.ok(created.status >= 200 && created.status < 300, 'Local Auth user creation failed');
    const id = created.body.id;
    assert.equal(typeof id, 'string');
    identities.push(id);
    const session = await request({ path: '/auth/v1/token?grant_type=password', method: 'POST', body: { email, password } });
    assert.equal(session.status, 200);
    assert.equal(typeof session.body.access_token, 'string');
    return { id, token: session.body.access_token };
  }
  const a = await user(), b = await user(), absent = await user();
  for (const actor of [a,b]) {
    const profile = await rest({ path: 'profiles', token: actor.token, method: 'POST', body: { user_id: actor.id } });
    assert.equal(profile.status, 201);
  }
  const workout = actor => ({ user_id: actor.id, source: 'manual', external_id: randomUUID(), started_at: '2026-10-02T00:00:00Z', ended_at: '2026-10-02T00:35:00Z', duration_seconds: 1800, duration_basis: 'active', distance_meters: 5000 });
  const payload = workout(a);
  const createdA = await rest({ path: 'workouts', token: a.token, method: 'POST', body: payload });
  assert.equal(createdA.status,201);
  const wa = createdA.body[0];
  const createdB = await rest({ path: 'workouts', token: b.token, method: 'POST', body: workout(b) });
  assert.equal(createdB.status,201);
  const wb = createdB.body[0];

  await t.test('A reads own generated pace', async () => {
    const result = await rest({ path: `workouts?id=eq.${wa.id}`, token: a.token });
    assert.equal(result.status,200);
    assert.equal(result.body[0].avg_pace_seconds_per_km,360);
  });
  await t.test('A SELECT of B returns zero rows', async () => {
    const result = await rest({ path: `workouts?id=eq.${wb.id}`, token: a.token });
    assert.equal(result.status,200); assert.deepEqual(result.body,[]);
  });
  await t.test('A UPDATE/DELETE of B affects zero rows', async () => {
    for (const method of ['PATCH','DELETE']) {
      const result = await rest({ path: `workouts?id=eq.${wb.id}`, token: a.token, method, body: method === 'PATCH' ? { distance_meters: 1 } : undefined });
      assert.equal(result.status,200); assert.deepEqual(result.body,[]);
    }
    const unchanged = await rest({ path: `workouts?id=eq.${wb.id}`, token: b.token });
    assert.equal(unchanged.body[0].distance_meters,5000);
  });
  await t.test('A cannot INSERT under B ownership', async () => {
    denied(await rest({ path: 'workouts', token: a.token, method:'POST', body:workout(b) }));
  });
  await t.test('same external ID replay and offline retry cannot duplicate', async () => {
    for (let retry=0;retry<2;retry++) {
      const result=await rest({ path:'workouts',token:a.token,method:'POST',body:payload });
      assert.equal(result.status,409); assert.equal(result.body.code,'23505');
    }
    const result=await rest({ path:`workouts?external_id=eq.${payload.external_id}`,token:a.token });
    assert.equal(result.body.length,1);
  });
  await t.test('revision is server-managed and stale PATCH affects zero rows', async () => {
    const result=await rest({ path:`workouts?id=eq.${wa.id}&revision=eq.1`,token:a.token,method:'PATCH',body:{distance_meters:6000} });
    assert.equal(result.status,200); assert.equal(result.body[0].revision,2);
    assert.equal(result.body[0].created_at,wa.created_at);
    assert.ok(Date.parse(result.body[0].updated_at)>Date.parse(wa.updated_at));
    const stale=await rest({ path:`workouts?id=eq.${wa.id}&revision=eq.1`,token:a.token,method:'PATCH',body:{distance_meters:1} });
    assert.equal(stale.status,200); assert.deepEqual(stale.body,[]);
    denied(await rest({ path:`workouts?id=eq.${wa.id}`,token:a.token,method:'PATCH',body:{revision:99} }));
  });
  await t.test('cross-user shoe link is rejected', async () => {
    const shoe=await rest({ path:'shoes',token:b.token,method:'POST',body:{user_id:b.id,nickname:'B'} });
    assert.equal(shoe.status,201);
    const result=await rest({ path:'workout_shoes',token:a.token,method:'POST',body:{user_id:a.id,workout_id:wa.id,shoe_id:shoe.body[0].id} });
    assert.equal(result.status,409); assert.equal(result.body.code,'23503');
  });
  await t.test('membership absence and inactivity deny business inserts', async () => {
    denied(await rest({ path:'workouts',token:absent.token,method:'POST',body:workout(absent) }));
    const inactive=await rest({ path:`profiles?user_id=eq.${a.id}`,token:a.token,method:'PATCH',body:{status:'inactive'} });
    assert.equal(inactive.status,200);
    const hidden=await rest({ path:'workouts',token:a.token }); assert.deepEqual(hidden.body,[]);
    denied(await rest({ path:'workouts',token:a.token,method:'POST',body:workout(a) }));
    const active=await rest({ path:`profiles?user_id=eq.${a.id}`,token:a.token,method:'PATCH',body:{status:'active'} });
    assert.equal(active.status,200);
    const visible=await rest({path:`workouts?id=eq.${wa.id}`,token:a.token});
    assert.equal(visible.status,200); assert.equal(visible.body.length,1);
  });
  await t.test('Contract fixture maps to DB and rejects invalid metrics', async () => {
    const fixture=JSON.parse(await readFile(join(contractRoot,'src/import/fixtures/workout-contract-v1.json'),'utf8'));
    const parsed=parseWorkoutImportV1(fixture);
    const healthkit={...parsed.workouts[0],user_id:a.id};
    const stored=await rest({path:'workouts',token:a.token,method:'POST',body:healthkit});
    assert.equal(stored.status,201); assert.equal(stored.body[0].avg_pace_seconds_per_km,360);
    const replay=await rest({path:'workouts',token:a.token,method:'POST',body:healthkit});
    assert.equal(replay.status,409); assert.equal(replay.body.code,'23505');
    for(const distance of [null,0,5000]) {
      const manual={...healthkit,source:'manual',external_id:randomUUID(),healthkit_uuid:null,distance_meters:distance,avg_heart_rate:null,max_heart_rate:null};
      const contract=parseWorkoutImportV1({...fixture,workouts:[manualWithoutOwner(manual)]});
      const result=await rest({path:'workouts',token:a.token,method:'POST',body:{...contract.workouts[0],user_id:a.id}});
      assert.equal(result.status,201); assert.equal(result.body[0].avg_pace_seconds_per_km,distance>0?360:null);
      assert.equal(result.body[0].avg_heart_rate,null); assert.equal(result.body[0].max_heart_rate,null);
    }
    for(const invalid of [{healthkit_uuid:randomUUID()},{avg_heart_rate:180,max_heart_rate:100},{duration_seconds:0},{duration_seconds:2101.001}]) {
      const candidate={...healthkit,external_id:randomUUID(),...invalid};
      if(!('healthkit_uuid' in invalid)) candidate.healthkit_uuid=candidate.external_id;
      const result=await rest({path:'workouts',token:a.token,method:'POST',body:candidate});
      assert.equal(result.status,400); assert.equal(result.body.code,'23514');
    }
  });
  await t.test('authenticated API cannot write protected audit or identity columns',async()=>{
    const forbidden={created_at:'2000-01-01T00:00:00Z',updated_at:'2000-01-01T00:00:00Z',revision:99,user_id:b.id,id:randomUUID(),source:'healthkit',external_id:randomUUID(),healthkit_uuid:randomUUID(),avg_pace_seconds_per_km:1};
    for(const [column,value] of Object.entries(forbidden)) {
      const result=await rest({path:`workouts?id=eq.${wa.id}`,token:a.token,method:'PATCH',body:{[column]:value}});
      if(column==='avg_pace_seconds_per_km') {assert.equal(result.status,400);assert.equal(result.body.code,'428C9');} else denied(result);
    }
    for(const column of ['created_at','updated_at','revision','id','avg_pace_seconds_per_km']) {
      const result=await rest({path:'workouts',token:a.token,method:'POST',body:{...workout(a),[column]:forbidden[column]}});
      if(column==='avg_pace_seconds_per_km') {assert.equal(result.status,400);assert.equal(result.body.code,'428C9');} else denied(result);
    }
  });
  await t.test('anon and service role have no running permission', async () => {
    for (const actor of [{ key:anon,token:anon },{ key:service,token:service }]) {
      for (const method of ['GET','POST','PATCH','DELETE']) {
        denied(await rest({ path:method === 'POST' ? 'workouts' : `workouts?id=eq.${wa.id}`, ...actor, method, body:method === 'POST' ? workout(a) : method === 'PATCH' ? { distance_meters: 1 } : undefined }));
      }
    }
  });
  await t.test('medical fixture retains public read and service writes', async () => {
    const article=await rest({ path:'articles?limit=1',schema:'public' }); assert.equal(article.status,200);
    denied(await rest({ path:'collector_runs',schema:'public' }));
    const run=await rest({ path:'collector_runs',schema:'public',key:service,token:service,method:'POST',body:{started_at:'2026-10-02T00:00:00Z',finished_at:'2026-10-02T00:01:00Z',result:'SUCCESS'} });
    assert.equal(run.status,201);
    const state=await rest({ path:'collector_alert_state?singleton_id=eq.true',schema:'public',key:service,token:service,method:'PATCH',body:{state:{fixture:true}} });
    assert.equal(state.status,200); assert.equal(state.body.length,1);
    const cleanup=await rest({ path:`collector_runs?id=eq.${run.body[0].id}`,schema:'public',key:service,token:service,method:'DELETE' });
    assert.equal(cleanup.status,200);
    const reset=await rest({ path:'collector_alert_state?singleton_id=eq.true',schema:'public',key:service,token:service,method:'PATCH',body:{state:{version:1,activeIncidents:{},events:[]}} });
    assert.equal(reset.status,200);
  });
  await t.test('A DELETE succeeds', async () => {
    const result=await rest({ path:`workouts?id=eq.${wa.id}`,token:a.token,method:'DELETE' });
    assert.equal(result.status,200); assert.equal(result.body.length,1);
  });
  await t.test('profile withdrawal cascades running records and preserves Auth',async()=>{
    const shoe=await rest({path:'shoes',token:a.token,method:'POST',body:{user_id:a.id,nickname:'cascade'}});
    assert.equal(shoe.status,201);
    const remaining=await rest({path:'workouts?limit=1',token:a.token}); assert.ok(remaining.body.length>0);
    const link=await rest({path:'workout_shoes',token:a.token,method:'POST',body:{user_id:a.id,workout_id:remaining.body[0].id,shoe_id:shoe.body[0].id}});
    assert.equal(link.status,201);
    const removed=await rest({path:`profiles?user_id=eq.${a.id}`,token:a.token,method:'DELETE'});
    assert.equal(removed.status,200); assert.equal(removed.body.length,1);
    const auth=await request({path:`/auth/v1/admin/users/${a.id}`,token:service,key:service});
    assert.equal(auth.status,200); assert.equal(auth.body.id,a.id);
    const restored=await rest({path:'profiles',token:a.token,method:'POST',body:{user_id:a.id}}); assert.equal(restored.status,201);
    for(const table of ['shoes','workouts','workout_shoes','import_batches']) {
      const result=await rest({path:table,token:a.token}); assert.equal(result.status,200); assert.deepEqual(result.body,[]);
    }
  });
});

function manualWithoutOwner(row) {
  const {user_id: _owner,...workout}=row;
  return workout;
}
