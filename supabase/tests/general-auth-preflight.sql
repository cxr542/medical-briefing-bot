-- Read-only preflight, run against confirmed target before each rollout phase.
SELECT current_database(), current_user;
SELECT nspname FROM pg_namespace WHERE nspname IN ('customer_auth','running');
SELECT schemaname,tablename,rowsecurity FROM pg_tables WHERE schemaname IN ('public','customer_auth','running');
SELECT schemaname,tablename,policyname,roles,cmd,qual FROM pg_policies WHERE schemaname IN ('public','customer_auth');
SELECT grantee,table_schema,table_name,privilege_type FROM information_schema.role_table_grants WHERE table_name IN ('articles','collector_runs','collector_alert_state');
SELECT version,name FROM supabase_migrations.schema_migrations ORDER BY version;
SELECT n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname IN ('customer_auth_rpc','customer_admin_rpc');
