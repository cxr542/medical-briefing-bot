BEGIN;
DO $$ BEGIN
  IF current_setting('running_test.local_fixture',true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'History fixture is local-only; never run on Production';
  END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS supabase_migrations;
CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version text PRIMARY KEY,
  statements text[],
  name text
);
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES
  ('20260928064906','collector_alert_state',ARRAY['-- synthetic history marker: corresponding schema supplied by medical_baseline.sql']),
  ('20260929063328','20260928010000_collector_runs_admin_only',ARRAY['-- synthetic history marker: corresponding schema supplied by medical_baseline.sql']);
COMMIT;
