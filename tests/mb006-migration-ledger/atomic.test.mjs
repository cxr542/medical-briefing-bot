import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { provision, cleanup } from '../../scripts/mb006-migration-ledger/local.mjs';
import { runMigration, inspectState, historyQuery, loadMigration } from '../../scripts/mb006-migration-ledger/engine.mjs';
import { readTarget, proveIsolation, sql } from '../../scripts/mb006-migration-ledger/target.mjs';
import { MIGRATIONS, LOCK, key } from '../../scripts/mb006-migration-ledger/manifest.mjs';
import { checkedBody, transactionBody } from '../../scripts/mb006-migration-ledger/sql-boundaries.mjs';
import { main } from '../../scripts/mb006-migration-ledger/cli.mjs';

const evidence = process.env.MB006_LEDGER_EVIDENCE_DIR || await mkdtemp(join(tmpdir(),'mb006-ledger-evidence-'));
await mkdir(evidence,{recursive:true});
console.log('EVIDENCE_DIRECTORY '+evidence);
const versions = MIGRATIONS.map(item=>item.version);
async function all(context) { for(const version of versions) await runMigration({descriptor:context.descriptor,version,mode:'apply'}); }
async function unchanged(target) {
  return sql(target, `SELECT jsonb_build_object('functions',(SELECT jsonb_agg(jsonb_build_array(n.nspname,p.proname,md5(p.prosrc),p.prosecdef,p.proconfig,p.proacl::text) ORDER BY n.nspname,p.proname)
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='customer_auth' OR (n.nspname='public' AND p.proname IN ('customer_auth_rpc','customer_admin_rpc'))),
    'auth_rows',(SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY id)) FROM customer_auth.customer_admins t),
    'sessions',(SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY token_hash)) FROM customer_auth.customer_sessions t),
    'collector',(SELECT jsonb_agg(row_to_json(t) ORDER BY id) FROM public.collector_runs t),
    'alerts',(SELECT md5(string_agg(row_to_json(t)::text,',' ORDER BY singleton_id)) FROM public.collector_alert_state t),
    'articles',(SELECT jsonb_agg(row_to_json(t) ORDER BY id) FROM public.articles t),
    'catalog',(SELECT jsonb_agg(jsonb_build_array(n.nspname,c.relname,c.relrowsecurity,c.relforcerowsecurity,c.relacl::text) ORDER BY n.nspname,c.relname) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE c.relkind='r' AND (n.nspname='customer_auth' OR (n.nspname='public' AND c.relname IN ('collector_runs','collector_alert_state','articles')))));`);
}
const absent = async target => {
  assert.equal(await sql(target,"SELECT count(*) FROM pg_namespace WHERE nspname='support'"),'0');
  assert.equal((await inspectState(target)).count,4);
};
async function waitFor(target,query) {
  for(let attempt=0;attempt<60;attempt++) { if(await sql(target,query)==='1') return; await delay(50); }
  assert.fail('Timed out waiting for injected database state');
}
function scenario(name, action) {
  test(name, {timeout:60000}, async()=>{
    const context=await provision();
    const target=await readTarget(context.descriptor);
    let result='FAIL';
    try { await action(context,target); result='PASS'; }
    finally {
      const proof=await proveIsolation(target);
      const audit=await readFile(join(context.directory,'audit.jsonl'),'utf8');
      const observed=JSON.parse(await sql(target,"SELECT jsonb_build_object('versions',(SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations),'support_tables',(SELECT count(*) FROM pg_tables WHERE schemaname='support'));"));
      await cleanup(context.descriptor);
      await writeFile(join(evidence,name.slice(0,3)+'.json'),JSON.stringify({name,result,target:proof,observed,audit:audit.split('\n').filter(Boolean).map(line=>JSON.parse(line)),cleanup:'own container and volume removed'},null,2));
      await rm(context.directory,{recursive:true});
    }
  });
}

scenario('T01 normal migration and default dry-run', async(context,target)=>{
  const dry=await runMigration({descriptor:context.descriptor,version:versions[0]});
  assert.equal(dry.result,'DRY_RUN');await absent(target);
  assert.equal((await runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'})).result,'COMMIT_CONFIRMED');
  assert.equal(await sql(target,"SELECT count(*) FROM pg_tables WHERE schemaname='support'"),'5');
});
scenario('T02 ledger source checksum and audit', async(context,target)=>{
  await runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'});
  const row=JSON.parse(await sql(target,historyQuery)).at(-1);
  assert.equal(row[0],versions[0]);assert.equal(row[4],key(MIGRATIONS[0]));
  assert.equal(row[1][0],(await loadMigration(versions[0])).source);
  const events=(await readFile(join(context.directory,'audit.jsonl'),'utf8')).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(events.at(-1).event,'COMMIT_CONFIRMED');assert.ok(events.every(event=>event.sha256===MIGRATIONS[0].sha256));
});
scenario('T03 preserve four complete legacy rows', async(context,target)=>{
  const before=JSON.parse(await sql(target,historyQuery));await all(context);
  assert.deepEqual(JSON.parse(await sql(target,historyQuery)).slice(0,4),before);
});
scenario('T04 refuse duplicate version',async(context,target)=>{
  await runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'});
  await assert.rejects(runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'}),/ALREADY_APPLIED/);
  assert.equal((await inspectState(target)).count,5);
});
scenario('T05 refuse reverse order',async(context,target)=>{
  for(const version of versions.slice(1)) await assert.rejects(runMigration({descriptor:context.descriptor,version,mode:'apply'}),/MIGRATION_ORDER/);
  await absent(target);
});
scenario('T06 fail midway through SQL and retry',async(context,target)=>{
  await sql(target,"CREATE FUNCTION public.reject_index() RETURNS event_trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected SQL failure'; END $$; CREATE EVENT TRIGGER injected_index_failure ON ddl_command_start WHEN TAG IN ('CREATE INDEX') EXECUTE FUNCTION public.reject_index();");
  await assert.rejects(runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'}));await absent(target);
  await sql(target,'DROP EVENT TRIGGER injected_index_failure; DROP FUNCTION public.reject_index();');
  await runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'});assert.equal((await inspectState(target)).count,5);
});
scenario('T07 ledger INSERT failure rolls back DDL',async(context,target)=>{
  await sql(target,"CREATE FUNCTION public.reject_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected ledger failure'; END $$; CREATE TRIGGER injected_ledger_failure BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.reject_ledger();");
  await assert.rejects(runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'}));await absent(target);
});
scenario('T08 connection termination before COMMIT',async(context,target)=>{
  await sql(target,"CREATE FUNCTION public.pause_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(30); RETURN NEW; END $$; CREATE TRIGGER pause_before_commit BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.pause_ledger();");
  const pending=runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'}).then(()=>null,error=>error);
  await waitFor(target,"SELECT count(*) FROM pg_stat_activity WHERE application_name='mb006-atomic-ledger' AND wait_event='PgSleep'");
  await sql(target,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='mb006-atomic-ledger' AND wait_event='PgSleep'");
  assert.ok(await pending instanceof Error);await absent(target);
});
scenario('T09 concurrent identical and different migrations',async(context,target)=>{
  await sql(target,"CREATE FUNCTION public.slow_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.5); RETURN NEW; END $$; CREATE TRIGGER slow_ledger BEFORE INSERT ON supabase_migrations.schema_migrations FOR EACH ROW EXECUTE FUNCTION public.slow_ledger();");
  const same=await Promise.allSettled([0,1].map(()=>runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'})));
  assert.equal(same.filter(result=>result.status==='fulfilled').length,1);assert.equal((await inspectState(target)).count,5);
  const attachment=runMigration({descriptor:context.descriptor,version:versions[1],mode:'apply'});
  await waitFor(target,"SELECT count(*) FROM pg_stat_activity WHERE application_name='mb006-atomic-ledger' AND wait_event='PgSleep'");
  await assert.rejects(runMigration({descriptor:context.descriptor,version:versions[2],mode:'apply'}),/MIGRATION_ORDER/);
  await attachment;assert.equal((await inspectState(target)).count,6);
});
scenario('T10 fail closed when advisory lock held',async(context,target)=>{
  const holder=sql(target,`SET application_name='phase4-lock-holder'; BEGIN; SELECT pg_advisory_xact_lock(${LOCK}); SELECT pg_sleep(30); ROLLBACK;`).then(()=>null,error=>error);
  await waitFor(target,"SELECT count(*) FROM pg_stat_activity WHERE application_name='phase4-lock-holder' AND wait_event='PgSleep'");
  try {await assert.rejects(runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'}));await absent(target);}
  finally {await sql(target,"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='phase4-lock-holder'");assert.ok(await holder instanceof Error);}
});
scenario('T11 reject checksum mismatch without editing migrations',async(context,target)=>{
  const original=await loadMigration(versions[0]);assert.throws(()=>checkedBody(original.source+'\n--tampered',original),/CHECKSUM_MISMATCH/);await absent(target);
});
scenario('T12 reject unexpected existing objects',async(context,target)=>{
  await sql(target,"CREATE SCHEMA support; CREATE TABLE support.unexpected(id integer);");
  await assert.rejects(runMigration({descriptor:context.descriptor,version:versions[0],mode:'apply'}));
  assert.equal(await sql(target,'SELECT count(*) FROM supabase_migrations.schema_migrations'),'4');assert.equal(await sql(target,"SELECT count(*) FROM pg_tables WHERE schemaname='support' AND tablename='unexpected'"),'1');
});
scenario('T13 reject production IDs and forged server identity',async(context,target)=>{
  for(const patch of [{project:'kkcvglldsoxglfjqnsga'},{host:'db.kkcvglldsoxglfjqnsga.supabase.co'},{system:'1'}]){
    const path=join(context.directory,'forged-'+Object.keys(patch)[0]+'.json');const {descriptor,...stored}=target;
    await writeFile(path,JSON.stringify({...stored,...patch}),{flag:'wx',mode:0o600});
    await assert.rejects(runMigration({descriptor:path,version:versions[0],mode:'apply'}));
  }
  await absent(target);
});
scenario('T14 reject connection strings and ignore production environment',async(context,target)=>{
  await assert.rejects(main(['--descriptor','postgres://invalid:invalid@remote.invalid/db','--version',versions[0]]),/LOCAL_DESCRIPTOR_REQUIRED/);
  await assert.rejects(main(['--db-url','postgres://remote.invalid/db']),/ONLY_LOCAL/);
  await assert.rejects(main(['--force-production','true']),/ONLY_LOCAL/);
  const names=['DATABASE_URL','DIRECT_URL','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','PGHOST','DOCKER_HOST'];
  const previous=names.map(name=>process.env[name]);
  try{for(const name of names)process.env[name]='https://kkcvglldsoxglfjqnsga.supabase.co';assert.equal((await runMigration({descriptor:context.descriptor,version:versions[0]})).result,'DRY_RUN');}
  finally{names.forEach((name,index)=>{if(previous[index]===undefined)delete process.env[name];else process.env[name]=previous[index];});}
  await absent(target);
});
scenario('T15 preserve full authentication functions and synthetic sessions',async(context,target)=>{
  const before=await unchanged(target);await all(context);assert.equal(await unchanged(target),before);
});
scenario('T16 preserve Collector and article objects and data',async(context,target)=>{
  const before=await unchanged(target);await all(context);assert.equal(await unchanged(target),before);
});
scenario('T17 execute complete ordered chain',async(context,target)=>{
  for(let index=0;index<versions.length;index++){await runMigration({descriptor:context.descriptor,version:versions[index],mode:'apply'});assert.equal((await inspectState(target)).count,5+index);}
  assert.equal(await sql(target,"SELECT count(*) FROM pg_tables WHERE schemaname='support'"),'10');
});
scenario('T18 exactly seven ledger rows and drift rejection',async(context,target)=>{
  await all(context);assert.equal((await inspectState(target)).count,7);
  assert.equal(await sql(target,"SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE ((n.nspname='support' AND p.proname IN ('admin_rpc','attachment_rpc')) OR (n.nspname='public' AND p.proname IN ('support_attachment_create_rpc','support_attachment_worker_rpc'))) AND position('ERRCODE=''PT409''' in p.prosrc)>0"),'4');
  await sql(target,'ALTER TABLE support.support_requests DISABLE ROW LEVEL SECURITY');
  await assert.rejects(inspectState(target),/OBJECT_LEDGER_MISMATCH/);
  await sql(target,'ALTER TABLE support.support_requests ENABLE ROW LEVEL SECURITY');
  await sql(target,"UPDATE supabase_migrations.schema_migrations SET name='synthetic drift' WHERE version='20261016014502'");
  await assert.rejects(inspectState(target),/APPLIED_HISTORY_MISMATCH/);
});

test('P01 SQL lexer preserves comments, quoted bodies and embedded COMMIT text',()=>{
  const source=`-- header\nBEGIN; /* a /* nested */ comment */ DO $x$ BEGIN RAISE NOTICE 'COMMIT;'; END $x$; SELECT 'it''s COMMIT;', E'a\\\'b;', "COMMIT;"; COMMIT; -- tail`;
  const body=transactionBody(source);assert.ok(body.includes("RAISE NOTICE 'COMMIT;'"));assert.ok(body.includes('/* a /* nested */ comment */'));
});
test('P02 reject inner top-level transaction control and malformed SQL',()=>{
  for(const statement of ['COMMIT','ROLLBACK','START TRANSACTION','SAVEPOINT x','PREPARE TRANSACTION \'x\'','END'])assert.throws(()=>transactionBody(`BEGIN; SELECT 1; ${statement}; COMMIT;`),/INNER_TRANSACTION_CONTROL/);
  for(const source of ["BEGIN; SELECT 'broken; COMMIT;",'BEGIN; /* broken','BEGIN; DO $x$ broken; COMMIT;','BEGIN; \\i /tmp/file\n COMMIT;'])assert.throws(()=>transactionBody(source));
});
