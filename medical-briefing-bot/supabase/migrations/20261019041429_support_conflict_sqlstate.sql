BEGIN;
DO $$
DECLARE
  signature text;
  definition text;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'support.admin_rpc(text,jsonb)',
    'public.support_attachment_create_rpc(jsonb,uuid)',
    'support.attachment_rpc(text,text,jsonb)',
    'public.support_attachment_worker_rpc(text,jsonb)'
  ] LOOP
    definition := pg_get_functiondef(signature::regprocedure);
    IF position('ERRCODE=''40001''' IN definition) = 0 THEN
      RAISE EXCEPTION 'Expected support conflict definition missing: %', signature;
    END IF;
    EXECUTE replace(definition, 'ERRCODE=''40001''', 'ERRCODE=''PT409''');
  END LOOP;
END $$;
COMMIT;
