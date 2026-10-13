-- LATE STAGE ONLY: application authorization and Collector server key must be verified first.
-- Deliberately changes only public.articles; preserves service_role writer permissions.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.articles') IS NULL OR to_regnamespace('customer_auth') IS NULL
 THEN RAISE EXCEPTION 'Article lockdown prerequisites absent'; END IF;
 IF NOT (SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role')
 THEN RAISE EXCEPTION 'Collector service role must bypass RLS'; END IF;
 IF EXISTS(SELECT 1 FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) AS required(privilege)
   WHERE NOT has_table_privilege('service_role','public.articles',required.privilege))
 THEN RAISE EXCEPTION 'Service writer grants missing'; END IF;
 IF EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='articles'
   AND policyname <> '누구나 기사 읽기 가능')
 THEN RAISE EXCEPTION 'Unexpected articles policy; manual review required'; END IF;
END $$;
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "누구나 기사 읽기 가능" ON public.articles;
REVOKE ALL PRIVILEGES ON TABLE public.articles FROM PUBLIC, anon, authenticated;
COMMIT;
