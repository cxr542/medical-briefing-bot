-- Prepared only. Requires the reviewed customer_auth foundation; no bootstrap/data/public-policy changes.
BEGIN;
CREATE FUNCTION customer_auth.manage(operation text,payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a customer_auth.customer_admins; u customer_auth.customer_users; result jsonb;
  term text := coalesce(payload->>'search',''); filter text := coalesce(payload->>'status','all');
  page integer := coalesce((payload->>'page')::integer,1); size integer := coalesce((payload->>'page_size')::integer,10);
  number text; seen text[] := ARRAY[]::text[]; amount integer; action_filter text := coalesce(payload->>'action','all');
BEGIN
  -- Authorization is repeated inside the same transaction as every read/mutation.
  SELECT aa.* INTO a FROM customer_auth.customer_admins aa JOIN customer_auth.customer_sessions s ON s.admin_id=aa.id
    WHERE s.token_hash=payload->>'admin_token_hash' AND s.kind='admin' AND s.revoked_at IS NULL AND s.expires_at>now()
      AND aa.active AND aa.session_version=s.principal_version AND aa.credential_version=s.credential_version FOR UPDATE OF aa,s;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF page<1 OR page>100000 OR size<1 OR size>50 OR length(term)>64 OR term ~ '[[:cntrl:]]' OR filter NOT IN ('all','active','inactive') THEN
    RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023';
  END IF;
  IF operation='list_users' THEN
    SELECT jsonb_build_object(
      'users',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (SELECT id,employee_number,active,created_at,updated_at,disabled_at FROM customer_auth.customer_users
        WHERE position(term IN employee_number)>0 AND (filter='all' OR active=(filter='active')) ORDER BY created_at DESC,id DESC LIMIT size OFFSET (page-1)*size) t),'[]'::jsonb),
      'total',(SELECT count(*) FROM customer_auth.customer_users WHERE position(term IN employee_number)>0 AND (filter='all' OR active=(filter='active'))),
      'stats',(SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER (WHERE active),'inactive',count(*) FILTER (WHERE NOT active)) FROM customer_auth.customer_users),
      'admin',jsonb_build_object('id',a.id,'login_id',a.login_id,'designation',a.designation),
      'credential',jsonb_build_object('configured',EXISTS(SELECT 1 FROM customer_auth.customer_credentials WHERE kind='shared'),'updated_at',(SELECT updated_at FROM customer_auth.customer_credentials WHERE kind='shared')),
      'page',page,'page_size',size) INTO result;
    RETURN result;
  ELSIF operation='audit' THEN
    IF action_filter NOT IN ('all','employee_added','employee_activated','employee_disabled','shared_password_changed','admin_login','failed_admin_login') THEN RAISE EXCEPTION 'Invalid action' USING ERRCODE='22023'; END IF;
    RETURN jsonb_build_object('events',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
      SELECT l.id,l.action,l.occurred_at,aa.login_id AS actor,cu.employee_number AS target
      FROM customer_auth.customer_audit_logs l LEFT JOIN customer_auth.customer_admins aa ON aa.id=l.actor_admin_id LEFT JOIN customer_auth.customer_users cu ON cu.id=l.target_user_id
      WHERE action_filter='all' OR l.action=action_filter ORDER BY l.occurred_at DESC,l.id DESC LIMIT size OFFSET (page-1)*size) t),'[]'::jsonb),
      'total',(SELECT count(*) FROM customer_auth.customer_audit_logs WHERE action_filter='all' OR action=action_filter),'page',page,'page_size',size);
  ELSIF operation='reauth_credential' THEN
    RETURN jsonb_build_object('password_hash',a.password_hash,'credential_version',a.credential_version);
  ELSIF operation='rotate_shared' THEN
    IF (payload->>'admin_credential_version')::bigint IS DISTINCT FROM a.credential_version THEN RAISE EXCEPTION 'Reauthentication required' USING ERRCODE='28000'; END IF;
    RETURN customer_auth.rpc('rotate_shared',payload);
  ELSIF operation='set_user_active' THEN
    IF NOT EXISTS(SELECT 1 FROM customer_auth.customer_users WHERE id=(payload->>'user_id')::uuid) THEN RAISE EXCEPTION 'User unavailable' USING ERRCODE='P0002'; END IF;
    RETURN customer_auth.rpc('set_user_active',payload);
  ELSIF operation IN ('add_user','bulk_add') THEN
    IF operation='add_user' THEN seen := ARRAY[payload->>'employee_number'];
    ELSE
      IF jsonb_typeof(payload->'employee_numbers') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'Invalid employees' USING ERRCODE='22023'; END IF;
      SELECT array_agg(value) INTO seen FROM jsonb_array_elements_text(payload->'employee_numbers');
    END IF;
    amount := coalesce(array_length(seen,1),0);
    IF amount<1 OR amount>100 THEN RAISE EXCEPTION 'Invalid count' USING ERRCODE='22023'; END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(seen) x)<>amount THEN RAISE EXCEPTION 'Duplicate employee' USING ERRCODE='23505'; END IF;
    FOREACH number IN ARRAY seen LOOP
      IF number IS NULL OR length(number)<1 OR length(number)>64 OR number ~ '[[:space:][:cntrl:]]' THEN RAISE EXCEPTION 'Invalid employee' USING ERRCODE='22023'; END IF;
      INSERT INTO customer_auth.customer_users(employee_number) VALUES(number) RETURNING * INTO u;
      INSERT INTO customer_auth.customer_audit_logs(actor_admin_id,action,target_user_id) VALUES(a.id,'employee_added',u.id);
    END LOOP;
    RETURN jsonb_build_object('created',amount);
  END IF;
  RAISE EXCEPTION 'Unsupported management operation' USING ERRCODE='22023';
END $$;
CREATE FUNCTION public.customer_admin_rpc(operation text,payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT customer_auth.manage(operation,payload)
$$;
REVOKE ALL ON FUNCTION customer_auth.manage(text,jsonb),public.customer_admin_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION customer_auth.manage(text,jsonb),public.customer_admin_rpc(text,jsonb) TO service_role;
COMMIT;
