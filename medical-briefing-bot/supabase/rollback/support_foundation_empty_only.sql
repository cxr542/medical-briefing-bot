BEGIN;
DO $$
BEGIN
  IF EXISTS(SELECT 1 FROM support.support_requests) THEN
    RAISE EXCEPTION 'Support contains data: disable the feature and preserve the schema';
  END IF;
END $$;
DROP FUNCTION public.customer_support_rpc(text,jsonb);
DROP FUNCTION public.admin_support_rpc(text,jsonb);
DROP FUNCTION support.customer_rpc(text,jsonb);
DROP FUNCTION support.admin_rpc(text,jsonb);
DROP TABLE support.support_comments,support.support_status_history,support.support_internal_notes,support.support_audit_events;
DROP TABLE support.support_requests;
DROP SCHEMA support;
COMMIT;
