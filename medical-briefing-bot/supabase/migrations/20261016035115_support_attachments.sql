BEGIN;
CREATE TABLE support.support_request_upload_keys (
  owner_id uuid NOT NULL REFERENCES customer_auth.customer_admins(id), client_key uuid NOT NULL,
  request_id uuid NOT NULL REFERENCES support.support_requests(id), request_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(owner_id,client_key)
);
CREATE TABLE support.support_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES support.support_requests(id) ON DELETE RESTRICT,
  client_key uuid NOT NULL,
  original_name text NOT NULL CHECK(length(original_name) BETWEEN 1 AND 200 AND original_name !~ '[[:cntrl:]/\\]'),
  mime text NOT NULL CHECK(mime IN ('image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')),
  bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 10485760),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  uploader_type text NOT NULL CHECK(uploader_type IN ('customer','internal')),
  uploader_id text NOT NULL,
  scan_status text NOT NULL DEFAULT 'pending' CHECK(scan_status IN ('pending','scanning','clean','infected','failed')),
  upload_status text NOT NULL DEFAULT 'reserved' CHECK(upload_status IN ('reserved','uploaded')),
  token_hash text NOT NULL CHECK(token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  scan_lease uuid, scan_until timestamptz, clean_path text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), deleted_at timestamptz,
  UNIQUE(request_id,client_key),
  CHECK((scan_status='clean')=(clean_path IS NOT NULL))
);
CREATE INDEX support_attachments_active ON support.support_attachments(request_id) WHERE deleted_at IS NULL;
CREATE INDEX support_attachments_queue ON support.support_attachments(created_at) WHERE deleted_at IS NULL AND upload_status='uploaded' AND scan_status='pending';
CREATE TABLE support.support_attachment_parts (
  attachment_id uuid NOT NULL REFERENCES support.support_attachments(id) ON DELETE RESTRICT,
  part integer NOT NULL CHECK(part BETWEEN 0 AND 9), bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 1048576),
  sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
  object_path text NOT NULL UNIQUE,
  ready boolean NOT NULL DEFAULT false, lease uuid NOT NULL, lease_until timestamptz NOT NULL,
  PRIMARY KEY(attachment_id,part)
);
CREATE TABLE support.support_attachment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), attachment_id uuid NOT NULL REFERENCES support.support_attachments(id),
  action text NOT NULL, actor_type text NOT NULL, actor_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE support.support_attachment_objects (
  bucket text NOT NULL CHECK(bucket IN ('support-quarantine','support-clean')), object_path text NOT NULL,
  attachment_id uuid NOT NULL REFERENCES support.support_attachments(id),
  created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(bucket,object_path)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['support_attachments','support_attachment_parts','support_attachment_audit','support_attachment_objects','support_request_upload_keys'] LOOP
    EXECUTE format('ALTER TABLE support.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE support.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON support.%I FROM PUBLIC,anon,authenticated',t);
    EXECUTE format('GRANT SELECT,INSERT,UPDATE ON support.%I TO service_role',t);
    EXECUTE format('CREATE POLICY support_attachment_server_only ON support.%I TO service_role USING(true) WITH CHECK(true)',t);
  END LOOP;
END $$;
GRANT DELETE ON support.support_attachment_objects TO service_role;

CREATE FUNCTION public.support_attachment_create_rpc(payload jsonb,client_key uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE owner uuid; saved support.support_request_upload_keys; result jsonb;
  body jsonb := payload-'admin_token_hash';
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  PERFORM support.customer_rpc('list',payload);
  SELECT s.admin_id INTO owner FROM customer_auth.customer_sessions s WHERE s.token_hash=payload->>'admin_token_hash';
  PERFORM pg_advisory_xact_lock(hashtextextended(owner::text||client_key::text,6006));
  SELECT * INTO saved FROM support.support_request_upload_keys k WHERE k.owner_id=owner AND k.client_key=support_attachment_create_rpc.client_key;
  IF FOUND THEN
    IF saved.request_body IS DISTINCT FROM body THEN RAISE EXCEPTION 'Retry payload mismatch' USING ERRCODE='40001'; END IF;
    result:=support.customer_rpc('detail',jsonb_build_object('admin_token_hash',payload->>'admin_token_hash','request_id',saved.request_id));
    RETURN jsonb_build_object('request',result->'request');
  END IF;
  result:=support.customer_rpc('create',payload);
  INSERT INTO support.support_request_upload_keys(owner_id,client_key,request_id,request_body)
    VALUES(owner,client_key,(result->'request'->>'id')::uuid,body);
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.support_attachment_create_rpc(jsonb,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_attachment_create_rpc(jsonb,uuid) TO service_role;

CREATE FUNCTION support.attachment_rpc(audience text,operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE rid uuid := (payload->>'request_id')::uuid; a support.support_attachments;
  p support.support_attachment_parts; actor text; token text := payload->>'token_hash';
  idx integer; expected integer; result jsonb;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  IF audience='customer' THEN
    PERFORM support.customer_rpc('detail',payload);
    SELECT s.admin_id::text INTO actor FROM customer_auth.customer_sessions s WHERE s.token_hash=payload->>'admin_token_hash';
  ELSIF audience='internal' AND (payload->>'actor_id') ~ '^[0-9a-f]{64}$' THEN actor:=payload->>'actor_id';
  ELSE RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  PERFORM 1 FROM support.support_requests WHERE id=rid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found' USING ERRCODE='P0002'; END IF;
  IF operation='list' THEN
    SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.created_at,x.id),'[]') INTO result FROM
      (SELECT id,original_name,mime,bytes,scan_status,upload_status,created_at FROM support.support_attachments WHERE request_id=rid AND deleted_at IS NULL) x;
    RETURN jsonb_build_object('attachments',result);
  END IF;
  IF operation='prepare' THEN
    IF (payload->>'token_hash') !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid token' USING ERRCODE='22023'; END IF;
    SELECT * INTO a FROM support.support_attachments WHERE request_id=rid AND client_key=(payload->>'client_key')::uuid FOR UPDATE;
    IF FOUND THEN
      IF a.deleted_at IS NOT NULL OR a.sha256 IS DISTINCT FROM payload->>'sha256' OR a.bytes<>(payload->>'bytes')::integer
        OR a.mime IS DISTINCT FROM payload->>'mime' OR a.original_name IS DISTINCT FROM payload->>'original_name' THEN
        RAISE EXCEPTION 'Duplicate mismatch' USING ERRCODE='40001'; END IF;
      UPDATE support.support_attachments SET token_hash=token,expires_at=now()+interval '5 minutes' WHERE id=a.id RETURNING * INTO a;
      INSERT INTO support.support_attachment_audit(attachment_id,action,actor_type,actor_id) VALUES(a.id,'grant_renewed',audience,actor);
    ELSE
      IF (SELECT count(*) FROM support.support_attachments WHERE request_id=rid AND deleted_at IS NULL)>=5 THEN RAISE EXCEPTION 'Attachment limit' USING ERRCODE='22023'; END IF;
      IF EXISTS(SELECT 1 FROM support.support_attachments WHERE request_id=rid AND deleted_at IS NULL AND sha256=payload->>'sha256') THEN
        RAISE EXCEPTION 'Duplicate file' USING ERRCODE='40001'; END IF;
      INSERT INTO support.support_attachments(request_id,client_key,original_name,mime,bytes,sha256,uploader_type,uploader_id,token_hash)
        VALUES(rid,(payload->>'client_key')::uuid,payload->>'original_name',payload->>'mime',(payload->>'bytes')::integer,payload->>'sha256',audience,actor,token) RETURNING * INTO a;
      INSERT INTO support.support_attachment_audit(attachment_id,action,actor_type,actor_id) VALUES(a.id,'reserved',audience,actor);
    END IF;
    RETURN jsonb_build_object('id',a.id,'expires_at',a.expires_at,'uploaded',a.upload_status='uploaded');
  END IF;
  SELECT * INTO a FROM support.support_attachments WHERE request_id=rid AND id=(payload->>'attachment_id')::uuid AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Not found' USING ERRCODE='P0002'; END IF;
  IF operation='delete' THEN
    UPDATE support.support_attachments SET deleted_at=now() WHERE id=a.id;
  ELSIF operation='download' THEN
    IF a.scan_status<>'clean' THEN RAISE EXCEPTION 'Quarantined' USING ERRCODE='55000'; END IF;
    INSERT INTO support.support_attachment_audit(attachment_id,action,actor_type,actor_id) VALUES(a.id,'download',audience,actor);
    RETURN to_jsonb(a);
  ELSIF operation IN ('part','complete') THEN
    IF a.expires_at<=clock_timestamp() OR a.token_hash IS DISTINCT FROM token THEN RAISE EXCEPTION 'Upload expired' USING ERRCODE='42501'; END IF;
    IF operation='complete' THEN
      IF (SELECT count(*) FROM support.support_attachment_parts WHERE attachment_id=a.id AND ready)<>ceil(a.bytes/1048576.0)::integer
        OR (SELECT coalesce(sum(bytes),0) FROM support.support_attachment_parts WHERE attachment_id=a.id AND ready)<>a.bytes THEN
        RAISE EXCEPTION 'Incomplete upload' USING ERRCODE='22023'; END IF;
      UPDATE support.support_attachments SET upload_status='uploaded' WHERE id=a.id;
    ELSE
      idx:=(payload->>'part')::integer;
      expected:=least(1048576,a.bytes-idx*1048576);
      IF a.upload_status<>'reserved' OR idx<0 OR idx>=ceil(a.bytes/1048576.0)::integer OR (payload->>'bytes')::integer<>expected THEN
        RAISE EXCEPTION 'Invalid part' USING ERRCODE='22023'; END IF;
      SELECT * INTO p FROM support.support_attachment_parts WHERE attachment_id=a.id AND part=idx FOR UPDATE;
      IF FOUND AND p.ready THEN
        IF p.sha256 IS DISTINCT FROM payload->>'sha256' THEN RAISE EXCEPTION 'Part conflict' USING ERRCODE='40001'; END IF;
        RETURN jsonb_build_object('ready',true);
      END IF;
      IF FOUND AND p.lease_until>now() THEN RAISE EXCEPTION 'Part busy' USING ERRCODE='40001'; END IF;
      INSERT INTO support.support_attachment_parts(attachment_id,part,bytes,sha256,object_path,lease,lease_until)
        VALUES(a.id,idx,expected,payload->>'sha256',rid::text||'/'||a.id::text||'/'||gen_random_uuid()::text,gen_random_uuid(),now()+interval '1 minute')
        ON CONFLICT(attachment_id,part) DO UPDATE SET bytes=EXCLUDED.bytes,sha256=EXCLUDED.sha256,object_path=EXCLUDED.object_path,lease=EXCLUDED.lease,lease_until=EXCLUDED.lease_until,ready=false RETURNING * INTO p;
      INSERT INTO support.support_attachment_objects(bucket,object_path,attachment_id) VALUES('support-quarantine',p.object_path,a.id);
      RETURN to_jsonb(p);
    END IF;
  ELSIF operation='part_done' THEN
    UPDATE support.support_attachment_parts SET ready=true WHERE attachment_id=a.id AND part=(payload->>'part')::integer AND lease=(payload->>'lease')::uuid AND lease_until>now();
    IF NOT FOUND THEN RAISE EXCEPTION 'Part conflict' USING ERRCODE='40001'; END IF;
  ELSIF operation='part_failed' THEN
    UPDATE support.support_attachment_parts SET lease_until=now() WHERE attachment_id=a.id AND part=(payload->>'part')::integer AND lease=(payload->>'lease')::uuid AND NOT ready;
  ELSE RAISE EXCEPTION 'Invalid operation' USING ERRCODE='22023'; END IF;
  INSERT INTO support.support_attachment_audit(attachment_id,action,actor_type,actor_id) VALUES(a.id,operation,audience,actor);
  RETURN jsonb_build_object('ok',true);
END $$;
CREATE FUNCTION public.support_attachment_rpc(audience text,operation text,payload jsonb) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$ SELECT support.attachment_rpc(audience,operation,payload) $$;
REVOKE ALL ON FUNCTION support.attachment_rpc(text,text,jsonb),public.support_attachment_rpc(text,text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION support.attachment_rpc(text,text,jsonb),public.support_attachment_rpc(text,text,jsonb) TO service_role;

CREATE FUNCTION public.support_attachment_worker_rpc(operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE a support.support_attachments; result jsonb;
BEGIN
  IF current_user<>'service_role' THEN RAISE EXCEPTION 'Denied' USING ERRCODE='42501'; END IF;
  IF operation='claim' THEN
    SELECT * INTO a FROM support.support_attachments WHERE deleted_at IS NULL AND upload_status='uploaded'
      AND (scan_status='pending' OR (scan_status='scanning' AND scan_until<now()))
      ORDER BY created_at,id LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN RETURN NULL; END IF;
    UPDATE support.support_attachments SET scan_status='scanning',scan_lease=gen_random_uuid(),scan_until=now()+interval '5 minutes' WHERE id=a.id RETURNING * INTO a;
    INSERT INTO support.support_attachment_audit(attachment_id,action,actor_type,actor_id) VALUES(a.id,'scan_started','scanner',a.scan_lease::text);
    INSERT INTO support.support_attachment_objects(bucket,object_path,attachment_id)
      VALUES('support-clean',a.request_id::text||'/'||a.id::text||'/'||a.scan_lease::text,a.id);
    SELECT jsonb_agg(to_jsonb(p) ORDER BY p.part) INTO result FROM support.support_attachment_parts p WHERE attachment_id=a.id AND ready;
    RETURN to_jsonb(a)||jsonb_build_object('parts',result);
  ELSIF operation='gc' THEN
    WITH expired AS (
      UPDATE support.support_attachments SET deleted_at=now()
      WHERE deleted_at IS NULL AND upload_status='reserved' AND expires_at<now()-interval '1 day'
      RETURNING id
    ) INSERT INTO support.support_attachment_audit(attachment_id,action,actor_type,actor_id)
      SELECT id,'expired_reservation','maintenance','retention' FROM expired;
    SELECT coalesce(jsonb_agg(to_jsonb(x)),'[]') INTO result FROM (
      SELECT o.bucket,o.object_path,o.attachment_id FROM support.support_attachment_objects o
      JOIN support.support_attachments attachment ON attachment.id=o.attachment_id
      WHERE (o.bucket='support-quarantine' AND o.created_at<now()-interval '7 days'
        AND (attachment.deleted_at IS NOT NULL OR attachment.scan_status IN ('clean','infected','failed')))
        OR (o.bucket='support-clean' AND o.created_at<now()-interval '30 days'
          AND (o.object_path IS DISTINCT FROM attachment.clean_path OR (attachment.deleted_at IS NOT NULL AND attachment.deleted_at<now()-interval '30 days')))
      ORDER BY o.created_at LIMIT 100
    ) x;
    RETURN result;
  ELSIF operation='gc_done' THEN
    DELETE FROM support.support_attachment_objects WHERE bucket=payload->>'bucket' AND object_path=payload->>'object_path';
    IF FOUND THEN INSERT INTO support.support_attachment_audit(attachment_id,action,actor_type,actor_id)
      VALUES((payload->>'attachment_id')::uuid,'object_removed','maintenance','retention'); END IF;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation='finish' THEN
    SELECT * INTO a FROM support.support_attachments WHERE id=(payload->>'attachment_id')::uuid AND deleted_at IS NULL AND scan_status='scanning'
      AND scan_lease=(payload->>'lease')::uuid AND scan_until>now() FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Scan conflict' USING ERRCODE='40001'; END IF;
    IF payload->>'status' NOT IN ('clean','infected','failed') OR payload->>'sha256' IS DISTINCT FROM a.sha256 THEN RAISE EXCEPTION 'Invalid scan' USING ERRCODE='22023'; END IF;
    IF payload->>'status'='clean' AND payload->>'clean_path' IS DISTINCT FROM a.request_id::text||'/'||a.id::text||'/'||a.scan_lease::text THEN
      RAISE EXCEPTION 'Invalid path' USING ERRCODE='22023'; END IF;
    UPDATE support.support_attachments SET scan_status=payload->>'status',clean_path=CASE WHEN payload->>'status'='clean' THEN payload->>'clean_path' END WHERE id=a.id;
    INSERT INTO support.support_attachment_audit(attachment_id,action,actor_type,actor_id) VALUES(a.id,'scan_'||(payload->>'status'),'scanner',a.scan_lease::text);
    RETURN jsonb_build_object('ok',true);
  END IF;
  RAISE EXCEPTION 'Invalid worker operation' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.support_attachment_worker_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.support_attachment_worker_rpc(text,jsonb) TO service_role;
COMMIT;
