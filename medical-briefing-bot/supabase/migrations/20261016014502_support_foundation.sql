BEGIN;

DO $$
BEGIN
  IF to_regclass('customer_auth.customer_admins') IS NULL
    OR to_regclass('customer_auth.customer_sessions') IS NULL
    OR to_regprocedure('customer_auth.validate_session(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Existing customer authentication foundation is required';
  END IF;
  IF to_regnamespace('support') IS NOT NULL
    OR to_regprocedure('public.customer_support_rpc(text,jsonb)') IS NOT NULL
    OR to_regprocedure('public.admin_support_rpc(text,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'Support migration already applied or conflicting objects exist';
  END IF;
END $$;

CREATE SCHEMA support;
REVOKE ALL ON SCHEMA support FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA support TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA support REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA support REVOKE ALL ON TABLES FROM anon, authenticated;

CREATE TABLE support.support_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_number integer GENERATED ALWAYS AS IDENTITY UNIQUE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL CHECK (length(btrim(description)) BETWEEN 1 AND 10000),
  status text NOT NULL DEFAULT 'received' CHECK (status IN ('received','reviewing','in_progress','waiting_customer','completed','on_hold','cancelled')),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  requester_admin_id uuid NOT NULL REFERENCES customer_auth.customer_admins(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  CHECK ((status IN ('completed','cancelled')) = (closed_at IS NOT NULL))
);
CREATE INDEX support_requests_owner_list ON support.support_requests(requester_admin_id,created_at DESC,id DESC);
CREATE INDEX support_requests_status_list ON support.support_requests(status,created_at DESC,id DESC);

CREATE TABLE support.support_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES support.support_requests(id) ON DELETE RESTRICT,
  author_type text NOT NULL CHECK (author_type = 'internal_admin'),
  actor_id text NOT NULL CHECK (actor_id ~ '^[0-9a-f]{64}$'),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE support.support_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES support.support_requests(id) ON DELETE RESTRICT,
  previous_status text CHECK (previous_status IN ('received','reviewing','in_progress','waiting_customer','completed','on_hold','cancelled')),
  new_status text NOT NULL CHECK (new_status IN ('received','reviewing','in_progress','waiting_customer','completed','on_hold','cancelled')),
  changed_by text NOT NULL,
  actor_type text NOT NULL CHECK (actor_type IN ('customer_admin','internal_admin')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE support.support_internal_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES support.support_requests(id) ON DELETE RESTRICT,
  actor_id text NOT NULL CHECK (actor_id ~ '^[0-9a-f]{64}$'),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE support.support_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES support.support_requests(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (action IN ('request_created','status_changed','comment_created','note_created')),
  actor_type text NOT NULL CHECK (actor_type IN ('customer_admin','internal_admin')),
  actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['support_requests','support_comments','support_status_history','support_internal_notes','support_audit_events'] LOOP
    EXECUTE format('ALTER TABLE support.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE support.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON support.%I FROM PUBLIC, anon, authenticated',t);
    EXECUTE format('CREATE POLICY support_server_only ON support.%I TO service_role USING (true) WITH CHECK (true)',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['support_comments','support_status_history','support_internal_notes','support_audit_events'] LOOP
    EXECUTE format('CREATE INDEX ON support.%I (request_id,created_at DESC,id DESC)',t);
  END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON support.support_requests TO service_role;
GRANT SELECT,INSERT ON support.support_comments,support.support_status_history,support.support_internal_notes,support.support_audit_events TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA support TO service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA support FROM PUBLIC,anon,authenticated;

CREATE FUNCTION support.customer_rpc(operation text,payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  a customer_auth.customer_admins;
  r support.support_requests;
  page integer := coalesce((payload->>'page')::integer,1);
  size integer := coalesce((payload->>'page_size')::integer,20);
  filter text := payload->>'status';
  result jsonb;
BEGIN
  IF current_user <> 'service_role' THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  SELECT aa.* INTO a FROM customer_auth.customer_admins aa
    JOIN customer_auth.customer_sessions s ON s.admin_id=aa.id
    WHERE s.kind='admin' AND s.token_hash=payload->>'admin_token_hash'
      AND s.revoked_at IS NULL AND s.expires_at>now() AND aa.active
      AND aa.session_version=s.principal_version AND aa.credential_version=s.credential_version
    FOR SHARE OF aa,s;
  IF a.id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
  IF page NOT BETWEEN 1 AND 99999 OR size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
  IF payload ? 'requester_admin_id' THEN RAISE EXCEPTION 'Invalid input' USING ERRCODE='22023'; END IF;
  IF operation='create' THEN
    IF jsonb_typeof(payload->'title') IS DISTINCT FROM 'string'
      OR jsonb_typeof(payload->'description') IS DISTINCT FROM 'string'
      OR length(btrim(payload->>'title')) NOT BETWEEN 1 AND 200
      OR length(btrim(payload->>'description')) NOT BETWEEN 1 AND 10000
      OR coalesce(payload->>'priority','normal') NOT IN ('low','normal','high') THEN
      RAISE EXCEPTION 'Invalid input' USING ERRCODE='22023';
    END IF;
    INSERT INTO support.support_requests(title,description,priority,requester_admin_id)
      VALUES(btrim(payload->>'title'),btrim(payload->>'description'),coalesce(payload->>'priority','normal'),a.id) RETURNING * INTO r;
    INSERT INTO support.support_status_history(request_id,new_status,changed_by,actor_type,reason)
      VALUES(r.id,'received',a.id::text,'customer_admin','Request created');
    INSERT INTO support.support_audit_events(request_id,action,actor_type,actor_id)
      VALUES(r.id,'request_created','customer_admin',a.id::text);
    RETURN jsonb_build_object('request',to_jsonb(r)-'requester_admin_id');
  ELSIF operation='list' THEN
    IF page NOT BETWEEN 1 AND 99999 OR size NOT BETWEEN 1 AND 50
      OR (filter IS NOT NULL AND filter NOT IN ('received','reviewing','in_progress','waiting_customer','completed','on_hold','cancelled')) THEN
      RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023';
    END IF;
    SELECT jsonb_build_object('requests',coalesce((SELECT jsonb_agg(to_jsonb(t)-'requester_admin_id') FROM (
      SELECT * FROM support.support_requests WHERE requester_admin_id=a.id AND (filter IS NULL OR status=filter)
      ORDER BY created_at DESC,id DESC LIMIT size OFFSET (page-1)*size) t),'[]'::jsonb),
      'total',(SELECT count(*) FROM support.support_requests WHERE requester_admin_id=a.id AND (filter IS NULL OR status=filter)),
      'page',page,'page_size',size) INTO result;
    RETURN result;
  ELSIF operation='detail' THEN
    SELECT * INTO r FROM support.support_requests WHERE id=(payload->>'request_id')::uuid AND requester_admin_id=a.id;
    IF r.id IS NULL THEN RAISE EXCEPTION 'Not found' USING ERRCODE='P0002'; END IF;
    RETURN jsonb_build_object('request',to_jsonb(r)-'requester_admin_id',
      'comments',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT id,author_type,body,created_at FROM support.support_comments WHERE request_id=r.id ORDER BY created_at DESC,id DESC LIMIT size OFFSET (page-1)*size) t),'[]'::jsonb),
      'comments_total',(SELECT count(*) FROM support.support_comments WHERE request_id=r.id),'page',page,'page_size',size);
  END IF;
  RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023';
END $$;

CREATE FUNCTION support.admin_rpc(operation text,payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  r support.support_requests;
  page integer := coalesce((payload->>'page')::integer,1);
  size integer := coalesce((payload->>'page_size')::integer,20);
  filter text := payload->>'status';
  actor text := payload->>'actor_id';
  target text := payload->>'status';
  allowed text[];
  previous text;
  result jsonb;
BEGIN
  IF current_user <> 'service_role' OR actor IS NULL OR actor !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501';
  END IF;
  IF page NOT BETWEEN 1 AND 99999 OR size NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023'; END IF;
  IF operation='list' THEN
    IF page NOT BETWEEN 1 AND 99999 OR size NOT BETWEEN 1 AND 50
      OR (filter IS NOT NULL AND filter NOT IN ('received','reviewing','in_progress','waiting_customer','completed','on_hold','cancelled')) THEN
      RAISE EXCEPTION 'Invalid query' USING ERRCODE='22023';
    END IF;
    SELECT jsonb_build_object('requests',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
      SELECT * FROM support.support_requests WHERE filter IS NULL OR status=filter
      ORDER BY created_at DESC,id DESC LIMIT size OFFSET (page-1)*size) t),'[]'::jsonb),
      'total',(SELECT count(*) FROM support.support_requests WHERE filter IS NULL OR status=filter),
      'page',page,'page_size',size) INTO result;
    RETURN result;
  END IF;
  SELECT * INTO r FROM support.support_requests WHERE id=(payload->>'request_id')::uuid FOR UPDATE;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Not found' USING ERRCODE='P0002'; END IF;
  IF operation='detail' THEN
    RETURN jsonb_build_object('request',to_jsonb(r),
      'comments',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT id,author_type,body,created_at FROM support.support_comments WHERE request_id=r.id ORDER BY created_at DESC,id DESC LIMIT size OFFSET (page-1)*size) t),'[]'::jsonb),
      'comments_total',(SELECT count(*) FROM support.support_comments WHERE request_id=r.id),
      'notes',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT id,body,actor_id,created_at FROM support.support_internal_notes WHERE request_id=r.id ORDER BY created_at DESC,id DESC LIMIT size OFFSET (page-1)*size) t),'[]'::jsonb),
      'notes_total',(SELECT count(*) FROM support.support_internal_notes WHERE request_id=r.id),
      'history',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT id,previous_status,new_status,changed_by,actor_type,reason,created_at FROM support.support_status_history WHERE request_id=r.id ORDER BY created_at DESC,id DESC LIMIT size OFFSET (page-1)*size) t),'[]'::jsonb),
      'history_total',(SELECT count(*) FROM support.support_status_history WHERE request_id=r.id),
      'audit',coalesce((SELECT jsonb_agg(to_jsonb(t)) FROM (
        SELECT id,action,actor_type,actor_id,created_at FROM support.support_audit_events WHERE request_id=r.id ORDER BY created_at DESC,id DESC LIMIT size OFFSET (page-1)*size) t),'[]'::jsonb),
      'audit_total',(SELECT count(*) FROM support.support_audit_events WHERE request_id=r.id),'page',page,'page_size',size);
  END IF;
  IF operation NOT IN ('status','comment','note') THEN RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
  IF jsonb_typeof(payload->'version') IS DISTINCT FROM 'number'
    OR (payload->>'version') !~ '^[1-9][0-9]{0,9}$'
    OR (payload->>'version')::bigint > 2147483646 THEN RAISE EXCEPTION 'Invalid version' USING ERRCODE='22023'; END IF;
  IF r.version<>(payload->>'version')::integer THEN RAISE EXCEPTION 'Version conflict' USING ERRCODE='40001'; END IF;
  IF operation='status' THEN
    allowed := CASE r.status
      WHEN 'received' THEN ARRAY['reviewing','on_hold','cancelled']
      WHEN 'reviewing' THEN ARRAY['in_progress','waiting_customer','on_hold','cancelled']
      WHEN 'in_progress' THEN ARRAY['waiting_customer','completed','on_hold','cancelled']
      WHEN 'waiting_customer' THEN ARRAY['in_progress','completed','on_hold','cancelled']
      WHEN 'on_hold' THEN ARRAY['reviewing','in_progress','cancelled']
      WHEN 'completed' THEN ARRAY['reviewing']
      WHEN 'cancelled' THEN ARRAY[]::text[] END;
    IF target IS NULL OR NOT (target=ANY(allowed))
      OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string'
      OR length(btrim(payload->>'reason')) NOT BETWEEN 1 AND 2000 THEN
      RAISE EXCEPTION 'Invalid transition' USING ERRCODE='22023';
    END IF;
    previous := r.status;
    UPDATE support.support_requests SET status=target,version=version+1,updated_at=now(),
      closed_at=CASE WHEN target IN ('completed','cancelled') THEN now() ELSE NULL END WHERE id=r.id RETURNING * INTO r;
    INSERT INTO support.support_status_history(request_id,previous_status,new_status,changed_by,actor_type,reason)
      VALUES(r.id,previous,r.status,actor,'internal_admin',btrim(payload->>'reason'));
  ELSE
    IF jsonb_typeof(payload->'body') IS DISTINCT FROM 'string' OR length(btrim(payload->>'body')) NOT BETWEEN 1 AND 10000 THEN
      RAISE EXCEPTION 'Invalid body' USING ERRCODE='22023';
    END IF;
    IF operation='comment' THEN
      INSERT INTO support.support_comments(request_id,author_type,actor_id,body) VALUES(r.id,'internal_admin',actor,btrim(payload->>'body'));
    ELSE
      INSERT INTO support.support_internal_notes(request_id,actor_id,body) VALUES(r.id,actor,btrim(payload->>'body'));
    END IF;
    UPDATE support.support_requests SET version=version+1,updated_at=now() WHERE id=r.id RETURNING * INTO r;
  END IF;
  INSERT INTO support.support_audit_events(request_id,action,actor_type,actor_id)
    VALUES(r.id,CASE operation WHEN 'status' THEN 'status_changed' WHEN 'comment' THEN 'comment_created' ELSE 'note_created' END,'internal_admin',actor);
  RETURN jsonb_build_object('request',to_jsonb(r));
END $$;

CREATE FUNCTION public.customer_support_rpc(operation text,payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT support.customer_rpc(operation,payload) $$;
CREATE FUNCTION public.admin_support_rpc(operation text,payload jsonb)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT support.admin_rpc(operation,payload) $$;
REVOKE ALL ON FUNCTION support.customer_rpc(text,jsonb),support.admin_rpc(text,jsonb),public.customer_support_rpc(text,jsonb),public.admin_support_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION support.customer_rpc(text,jsonb),support.admin_rpc(text,jsonb),public.customer_support_rpc(text,jsonb),public.admin_support_rpc(text,jsonb) TO service_role;

COMMIT;
