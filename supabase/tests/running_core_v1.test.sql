BEGIN;
SET LOCAL search_path = public, extensions;
SELECT no_plan();

SELECT has_schema('running');
SELECT is((SELECT count(*)::integer FROM pg_tables WHERE schemaname='running'),5,'Only five core tables');
SELECT has_table('running','profiles','running.profiles exists');
SELECT has_table('running','shoes','running.shoes exists');
SELECT has_table('running','workouts','running.workouts exists');
SELECT has_table('running','workout_shoes','running.workout_shoes exists');
SELECT has_table('running','import_batches','running.import_batches exists');
SELECT is(running_test.medical_snapshot(),(SELECT snapshot FROM running_test.baseline),'medical definitions unchanged');
SELECT ok(NOT has_schema_privilege('anon','running','USAGE'),'anon has no schema access');
SELECT ok(NOT has_schema_privilege('service_role','running','USAGE'),'service role has no schema access');
SELECT ok(has_schema_privilege('authenticated','running','USAGE'),'authenticated schema access');
SELECT ok(NOT has_table_privilege('service_role',format('running.%I',tablename),'SELECT,INSERT,UPDATE,DELETE'),'service has no table privileges: '||tablename) FROM pg_tables WHERE schemaname='running' ORDER BY tablename;
SELECT is((SELECT count(*)::integer FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='running' AND c.relkind='r' AND c.relrowsecurity),5,'all tables have RLS');
SELECT is((SELECT count(*)::integer FROM pg_policies WHERE schemaname='running'),20,'four policies per table');
SELECT is((SELECT count(*)::integer FROM pg_policies WHERE schemaname='running' AND cmd='UPDATE' AND qual IS NOT NULL AND with_check IS NOT NULL),5,'UPDATE checks both old and new rows');
SELECT is((SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='running' AND p.prosecdef),0,'no SECURITY DEFINER functions');
SELECT ok(NOT has_function_privilege('authenticated','running.stamp_audit()','EXECUTE'),'audit trigger not client callable');
SELECT ok(NOT has_function_privilege('service_role','running.valid_device(jsonb)','EXECUTE'),'service cannot execute validator');
SELECT ok(NOT has_column_privilege('authenticated','running.workouts','revision','INSERT'),'revision INSERT restricted');
SELECT ok(NOT has_column_privilege('authenticated','running.workouts','revision','UPDATE'),'revision UPDATE restricted');
SELECT ok(NOT has_column_privilege('authenticated','running.shoes','created_at','INSERT'),'audit INSERT restricted');
SELECT ok(NOT has_column_privilege('authenticated','running.workouts','external_id','UPDATE'),'external identity immutable');
SELECT ok(NOT has_column_privilege('authenticated','running.workouts','user_id','UPDATE'),'ownership immutable');
SELECT ok(NOT has_column_privilege('authenticated','running.workouts','avg_pace_seconds_per_km','UPDATE'),'generated pace restricted');
SELECT ok(NOT has_column_privilege('authenticated','running.workout_shoes','shoe_id','UPDATE'),'link PK immutable; delete and insert instead');
SELECT has_index('running','workouts','workouts_user_started_idx','workouts_user_started_idx exists');
SELECT has_index('running','workout_shoes','workout_shoes_user_shoe_idx','workout_shoes_user_shoe_idx exists');
SELECT has_index('running','import_batches','import_batches_user_started_idx','import_batches_user_started_idx exists');
SELECT has_pk('running','workout_shoes','link primary key exists');

INSERT INTO auth.users(id,email,aud,role) VALUES
 ('00000000-0000-0000-0000-000000000001','running-a@example.invalid','authenticated','authenticated'),
 ('00000000-0000-0000-0000-000000000002','running-b@example.invalid','authenticated','authenticated');
INSERT INTO running.profiles(user_id) VALUES
 ('00000000-0000-0000-0000-000000000001'),('00000000-0000-0000-0000-000000000002');
INSERT INTO running.shoes(id,user_id,nickname) VALUES
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','A'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','B');
INSERT INTO running.shoes(user_id,nickname,created_at) VALUES ('00000000-0000-0000-0000-000000000001','audit-test','2000-01-01');
SELECT ok((SELECT created_at >= transaction_timestamp() FROM running.shoes WHERE nickname='audit-test'),'DB overrides even privileged insert audit value');
INSERT INTO running.workouts(id,user_id,source,external_id,started_at,ended_at,duration_seconds,duration_basis,distance_meters) VALUES
 ('20000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','manual','30000000-0000-0000-0000-000000000001','2026-10-02T00:00:00Z','2026-10-02T00:35:00Z',1800,'active',5000),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','manual','30000000-0000-0000-0000-000000000002','2026-10-02T00:00:00Z','2026-10-02T00:35:00Z',1800,'active',NULL);
SELECT is((SELECT avg_pace_seconds_per_km FROM running.workouts WHERE id='20000000-0000-0000-0000-000000000001'),360::numeric,'active pace calculated');
SELECT is((SELECT avg_pace_seconds_per_km FROM running.workouts WHERE id='20000000-0000-0000-0000-000000000002'),NULL::numeric,'unknown distance pace NULL');
UPDATE running.workouts SET distance_meters=0 WHERE id='20000000-0000-0000-0000-000000000002';
SELECT is((SELECT avg_pace_seconds_per_km FROM running.workouts WHERE id='20000000-0000-0000-0000-000000000002'),NULL::numeric,'zero distance pace NULL');
SELECT throws_ok($$UPDATE running.workouts SET duration_seconds=0$$,'23514',NULL,'zero duration rejected');
SELECT throws_ok($$UPDATE running.workouts SET duration_seconds=2101.001$$,'23514',NULL,'elapsed tolerance enforced');
SELECT throws_ok($$UPDATE running.workouts SET duration_seconds='NaN'::numeric$$,'23514',NULL,'NaN rejected');
SELECT throws_ok($$UPDATE running.workouts SET distance_meters=-1$$,'23514',NULL,'negative distance rejected');
SELECT throws_ok($$UPDATE running.workouts SET active_calories=-1$$,'23514',NULL,'negative calories rejected');
SELECT throws_ok($$UPDATE running.workouts SET avg_heart_rate=180,max_heart_rate=100$$,'23514',NULL,'HR order enforced');
SELECT throws_ok($$UPDATE running.workouts SET avg_heart_rate=0$$,'23514',NULL,'zero HR rejected');
SELECT throws_ok($$UPDATE running.workouts SET ended_at=started_at$$,'23514',NULL,'equal dates rejected');
SELECT throws_ok($$UPDATE running.workouts SET duration_basis='moving'$$,'23514',NULL,'duration basis restricted');
SELECT throws_ok($$UPDATE running.workouts SET source='HealthKit'$$,'23514',NULL,'source slug restricted');
SELECT throws_ok($$UPDATE running.workouts SET sport_type='cycling'$$,'23514',NULL,'running only');
SELECT throws_ok($$UPDATE running.workouts SET source='healthkit',healthkit_uuid='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'$$,'23514',NULL,'HealthKit mismatch rejected');
SELECT throws_ok($$UPDATE running.workouts SET healthkit_uuid='not-a-uuid'$$,'22P02',NULL,'UUID type validation');
SELECT throws_ok($$UPDATE running.workouts SET device='{"serial":"secret"}'$$,'23514',NULL,'device allowlist');
SELECT throws_ok($$UPDATE running.workouts SET device=jsonb_build_object('model',repeat('x',129))$$,'23514',NULL,'device string size');
SELECT throws_ok($$UPDATE running.workouts SET source_metadata='{"raw":1}'$$,'23514',NULL,'metadata allowlist');
SELECT throws_ok($$UPDATE running.workouts SET source_metadata='{"source_version":[]}'$$,'23514',NULL,'metadata scalar validation');
SELECT throws_ok($$UPDATE running.workouts SET source_metadata=jsonb_build_object('source_version',repeat('x',8192))$$,'23514',NULL,'canonical metadata size limited');
SELECT throws_ok($$UPDATE running.workouts SET source_metadata='{"hr_method":null}'$$,'23514',NULL,'HR method enum');
SELECT throws_ok($$INSERT INTO running.workout_shoes(user_id,workout_id,shoe_id) VALUES ('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002')$$,'23503',NULL,'ownership FK even without RLS');
SELECT throws_ok($$INSERT INTO running.workouts(user_id,source,external_id,started_at,ended_at,duration_seconds,duration_basis) VALUES ('00000000-0000-0000-0000-000000000001','manual','30000000-0000-0000-0000-000000000001','2026-10-02T00:00:00Z','2026-10-02T00:35:00Z',1800,'active')$$,'23505',NULL,'duplicate import rejected');
INSERT INTO running.import_batches(id,user_id,source,received_count) VALUES ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','manual',1);
SELECT throws_ok($$UPDATE running.import_batches SET status='completed',finished_at=now()$$,'23514',NULL,'completed counts required');
SELECT lives_ok($$UPDATE running.import_batches SET inserted_count=1,status='completed',finished_at=now()$$,'valid completed batch');

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}',true);
SET LOCAL ROLE authenticated;
SELECT is((SELECT count(*)::integer FROM running.workouts),1,'A only sees own workout');
WITH changed AS (UPDATE running.workouts SET distance_meters=1 WHERE id='20000000-0000-0000-0000-000000000002' RETURNING id) SELECT is(count(*)::integer,0,'A cannot update B') FROM changed;
WITH changed AS (DELETE FROM running.workouts WHERE id='20000000-0000-0000-0000-000000000002' RETURNING id) SELECT is(count(*)::integer,0,'A cannot delete B') FROM changed;
SELECT throws_ok($$INSERT INTO running.shoes(user_id,nickname) VALUES ('00000000-0000-0000-0000-000000000002','attack')$$,'42501',NULL,'A cannot insert B');
SELECT throws_ok($$UPDATE running.workouts SET revision=99$$,'42501',NULL,'client cannot change revision');
SELECT throws_ok($$UPDATE running.workouts SET created_at=now()$$,'42501',NULL,'client cannot change audit');
SELECT throws_ok($$UPDATE running.workouts SET external_id='changed'$$,'42501',NULL,'client cannot change identity');
SELECT lives_ok($$UPDATE running.workouts SET distance_meters=6000$$,'allowed metric update');
SELECT is((SELECT revision FROM running.workouts),2::bigint,'revision incremented by DB');
SELECT lives_ok($$INSERT INTO running.workout_shoes(user_id,workout_id,shoe_id) VALUES ('00000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001')$$,'own FK allowed');
UPDATE running.profiles SET status='inactive';
SELECT is((SELECT count(*)::integer FROM running.workouts),0,'inactive profile hides business rows');
SELECT throws_ok($$INSERT INTO running.shoes(user_id,nickname) VALUES ('00000000-0000-0000-0000-000000000001','inactive')$$,'42501',NULL,'inactive insert denied');
UPDATE running.profiles SET status='active';
SELECT lives_ok($$DELETE FROM running.profiles$$,'membership withdrawal cascades through linked records');
RESET ROLE;
SELECT is((SELECT count(*)::integer FROM auth.users WHERE id='00000000-0000-0000-0000-000000000001'),1,'withdrawal preserves Auth account');
SELECT is((SELECT count(*)::integer FROM running.workout_shoes),0,'withdrawal removes links');

SET LOCAL ROLE service_role;
SELECT throws_ok($$SELECT * FROM running.workouts$$,'42501',NULL,'service running denied');
SELECT lives_ok($$SELECT * FROM public.articles$$,'medical service article read');
SELECT lives_ok($$INSERT INTO public.collector_runs(started_at,finished_at,result) VALUES (now(),now(),'SUCCESS')$$,'medical service collector write');
SELECT lives_ok($$UPDATE public.collector_alert_state SET state='{}'$$,'medical service alert write');
RESET ROLE;
SET LOCAL ROLE anon;
SELECT throws_ok($$SELECT * FROM running.workouts$$,'42501',NULL,'anon running denied');
SELECT lives_ok($$SELECT * FROM public.articles$$,'medical public article read');
SELECT throws_ok($$SELECT * FROM public.collector_runs$$,'42501',NULL,'medical runs remain private');
RESET ROLE;
SELECT is(running_test.medical_snapshot(),(SELECT snapshot FROM running_test.baseline),'medical definitions still unchanged');
SELECT * FROM finish();
ROLLBACK;
