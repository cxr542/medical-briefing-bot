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
ALTER TABLE supabase_migrations.schema_migrations
  ADD COLUMN IF NOT EXISTS created_by text,
  ADD COLUMN IF NOT EXISTS idempotency_key text UNIQUE,
  ADD COLUMN IF NOT EXISTS rollback text[];
INSERT INTO supabase_migrations.schema_migrations(version,name,statements) VALUES
  ('20260928064906','collector_alert_state',ARRAY['-- synthetic history marker: corresponding schema supplied by medical_baseline.sql']),
  ('20260929063328','20260928010000_collector_runs_admin_only',ARRAY['-- synthetic history marker']),
  ('20261007041102','article_keyword_boundary',ARRAY['-- synthetic history marker']),
  ('20261012043225','article_source_detail_url',ARRAY['-- synthetic history marker']),
  ('20261016014502','support_foundation',ARRAY['-- synthetic history marker']),
  ('20261016035115','support_attachments',ARRAY['-- synthetic history marker']),
  ('20261019041429','support_conflict_sqlstate',ARRAY['-- synthetic history marker']);
COMMIT;
