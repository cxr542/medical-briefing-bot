-- PREPARED ONLY. Apply only to an explicitly approved isolated/target database.
-- This migration neither initializes credentials nor changes medical/running objects.
BEGIN;
CREATE SCHEMA customer_auth;
REVOKE ALL ON SCHEMA customer_auth FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA customer_auth TO service_role;

CREATE TABLE customer_auth.customer_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_number text NOT NULL UNIQUE CHECK (length(employee_number) BETWEEN 1 AND 64 AND employee_number !~ '[[:space:][:cntrl:]]'),
  active boolean NOT NULL DEFAULT true,
  session_version bigint NOT NULL DEFAULT 1 CHECK (session_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz
);
CREATE TABLE customer_auth.customer_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('shared','individual')),
  user_id uuid REFERENCES customer_auth.customer_users(id),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid,
  CHECK ((kind='shared' AND user_id IS NULL) OR (kind='individual' AND user_id IS NOT NULL))
);
CREATE UNIQUE INDEX customer_one_shared_credential ON customer_auth.customer_credentials(kind) WHERE kind='shared';
CREATE UNIQUE INDEX customer_individual_credential ON customer_auth.customer_credentials(user_id) WHERE kind='individual';
CREATE TABLE customer_auth.customer_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), login_id text NOT NULL UNIQUE CHECK (length(login_id) BETWEEN 1 AND 64 AND login_id !~ '[[:space:][:cntrl:]]'),
  password_hash text NOT NULL CHECK (password_hash LIKE '$argon2id$%'),
  active boolean NOT NULL DEFAULT true, designation text NOT NULL DEFAULT 'primary' CHECK (designation IN ('primary','backup','manager','deputy')),
  credential_version bigint NOT NULL DEFAULT 1 CHECK (credential_version > 0),
  session_version bigint NOT NULL DEFAULT 1 CHECK (session_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz
);
ALTER TABLE customer_auth.customer_credentials ADD CONSTRAINT customer_credential_actor FOREIGN KEY (updated_by) REFERENCES customer_auth.customer_admins(id);
CREATE TABLE customer_auth.customer_sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  kind text NOT NULL CHECK (kind IN ('user','admin')),
  user_id uuid REFERENCES customer_auth.customer_users(id) ON DELETE CASCADE,
  admin_id uuid REFERENCES customer_auth.customer_admins(id) ON DELETE CASCADE,
  credential_version bigint NOT NULL CHECK (credential_version > 0), principal_version bigint NOT NULL CHECK (principal_version > 0),
  issued_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz,
  CHECK ((kind='user' AND user_id IS NOT NULL AND admin_id IS NULL) OR (kind='admin' AND admin_id IS NOT NULL AND user_id IS NULL)),
  CHECK (expires_at > issued_at AND expires_at <= issued_at + CASE WHEN kind='user' THEN interval '8 hours' ELSE interval '1 hour' END)
);
CREATE INDEX customer_sessions_user ON customer_auth.customer_sessions(user_id) WHERE user_id IS NOT NULL;
CREATE INDEX customer_sessions_admin ON customer_auth.customer_sessions(admin_id) WHERE admin_id IS NOT NULL;
CREATE INDEX customer_sessions_expiry ON customer_auth.customer_sessions(expires_at);
CREATE TABLE customer_auth.customer_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_admin_id uuid REFERENCES customer_auth.customer_admins(id),
  action text NOT NULL CHECK (action IN ('employee_added','employee_activated','employee_disabled','shared_password_changed','admin_login','failed_admin_login')),
  target_user_id uuid REFERENCES customer_auth.customer_users(id), occurred_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}' CHECK (jsonb_typeof(metadata)='object' AND metadata='{}'::jsonb)
);
CREATE INDEX customer_audit_time ON customer_auth.customer_audit_logs(occurred_at DESC,id);
CREATE TABLE customer_auth.customer_login_limits (
  scope text NOT NULL CHECK (scope IN ('ip','identity')), key_hash text NOT NULL CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  window_start timestamptz NOT NULL, attempts integer NOT NULL CHECK (attempts > 0), expires_at timestamptz NOT NULL,
  PRIMARY KEY (scope,key_hash,window_start)
);
CREATE INDEX customer_limits_expiry ON customer_auth.customer_login_limits(expires_at);

CREATE FUNCTION customer_auth.stamp_principal() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  NEW.updated_at := now();
  NEW.created_at := OLD.created_at;
  NEW.session_version := greatest(NEW.session_version, OLD.session_version);
  IF NEW.active IS DISTINCT FROM OLD.active THEN
    NEW.session_version := greatest(NEW.session_version, OLD.session_version + 1);
    NEW.disabled_at := CASE WHEN NEW.active THEN NULL ELSE now() END;
  END IF;
  IF TG_TABLE_NAME='customer_admins' THEN
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN NEW.credential_version := OLD.credential_version + 1;
    ELSE NEW.credential_version := greatest(NEW.credential_version, OLD.credential_version); END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_user_stamp BEFORE UPDATE ON customer_auth.customer_users FOR EACH ROW EXECUTE FUNCTION customer_auth.stamp_principal();
CREATE TRIGGER customer_admin_stamp BEFORE UPDATE ON customer_auth.customer_admins FOR EACH ROW EXECUTE FUNCTION customer_auth.stamp_principal();
CREATE FUNCTION customer_auth.stamp_credential() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash THEN NEW.credential_version := OLD.credential_version + 1;
  ELSE NEW.credential_version := greatest(NEW.credential_version, OLD.credential_version); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_credential_stamp BEFORE UPDATE ON customer_auth.customer_credentials FOR EACH ROW EXECUTE FUNCTION customer_auth.stamp_credential();

CREATE FUNCTION customer_auth.validate_session(p_kind text, p_hash text) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $$
  SELECT jsonb_build_object('id',coalesce(s.user_id,s.admin_id))
  FROM customer_auth.customer_sessions s
  LEFT JOIN customer_auth.customer_users u ON u.id=s.user_id
  LEFT JOIN customer_auth.customer_admins a ON a.id=s.admin_id
  LEFT JOIN customer_auth.customer_credentials c ON c.kind='shared'
  WHERE s.kind=p_kind AND s.token_hash=p_hash AND s.revoked_at IS NULL AND s.expires_at>now()
    AND ((s.kind='user' AND u.active AND u.session_version=s.principal_version AND c.credential_version=s.credential_version)
      OR (s.kind='admin' AND a.active AND a.session_version=s.principal_version AND a.credential_version=s.credential_version))
$$;

-- Fixed operation allowlist, no dynamic SQL. Invoker privileges required at every layer.
CREATE FUNCTION customer_auth.rpc(operation text, payload jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  u customer_auth.customer_users; a customer_auth.customer_admins; c customer_auth.customer_credentials;
  principal uuid; kind text; bucket timestamptz; ip_count integer; identity_count integer; affected integer;
BEGIN
  IF operation='consume_attempt' THEN
    bucket := to_timestamp(floor(extract(epoch FROM now())/900)*900);
    INSERT INTO customer_auth.customer_login_limits AS l VALUES ('ip',payload->>'ip',bucket,1,bucket+interval '15 minutes')
      ON CONFLICT (scope,key_hash,window_start) DO UPDATE SET attempts=least(l.attempts+1,101) RETURNING attempts INTO ip_count;
    INSERT INTO customer_auth.customer_login_limits AS l VALUES ('identity',payload->>'identity',bucket,1,bucket+interval '15 minutes')
      ON CONFLICT (scope,key_hash,window_start) DO UPDATE SET attempts=least(l.attempts+1,6) RETURNING attempts INTO identity_count;
    RETURN jsonb_build_object('allowed',ip_count<=100 AND identity_count<=5);
  ELSIF operation='lookup_user' THEN
    SELECT * INTO u FROM customer_auth.customer_users WHERE employee_number=payload->>'identifier';
    SELECT * INTO c FROM customer_auth.customer_credentials WHERE customer_credentials.kind='shared';
    IF u.id IS NULL OR c.id IS NULL THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('id',u.id,'active',u.active,'session_version',u.session_version,'password_hash',c.password_hash,'credential_version',c.credential_version);
  ELSIF operation='lookup_admin' THEN
    SELECT * INTO a FROM customer_auth.customer_admins WHERE login_id=payload->>'identifier';
    IF a.id IS NULL THEN RETURN NULL; END IF;
    RETURN jsonb_build_object('id',a.id,'active',a.active,'session_version',a.session_version,'password_hash',a.password_hash,'credential_version',a.credential_version);
  ELSIF operation='issue_session' THEN
    kind := payload->>'kind'; principal := (payload->>'principal_id')::uuid;
    IF kind='user' THEN
      SELECT * INTO c FROM customer_auth.customer_credentials WHERE customer_credentials.kind='shared' FOR UPDATE;
      SELECT * INTO u FROM customer_auth.customer_users WHERE id=principal FOR UPDATE;
      IF u.id IS NULL OR NOT u.active OR c.id IS NULL OR u.session_version<>(payload->>'principal_version')::bigint OR c.credential_version<>(payload->>'credential_version')::bigint THEN RETURN jsonb_build_object('ok',false); END IF;
    ELSIF kind='admin' THEN
      SELECT * INTO a FROM customer_auth.customer_admins WHERE id=principal FOR UPDATE;
      IF a.id IS NULL OR NOT a.active OR a.session_version<>(payload->>'principal_version')::bigint OR a.credential_version<>(payload->>'credential_version')::bigint THEN RETURN jsonb_build_object('ok',false); END IF;
    ELSE RAISE EXCEPTION 'Invalid principal kind'; END IF;
    INSERT INTO customer_auth.customer_sessions(token_hash,kind,user_id,admin_id,credential_version,principal_version,expires_at)
      VALUES(payload->>'token_hash',kind,CASE WHEN kind='user' THEN principal END,CASE WHEN kind='admin' THEN principal END,
      (payload->>'credential_version')::bigint,(payload->>'principal_version')::bigint,now()+CASE WHEN kind='user' THEN interval '8 hours' ELSE interval '1 hour' END);
    IF kind='admin' THEN INSERT INTO customer_auth.customer_audit_logs(actor_admin_id,action) VALUES(principal,'admin_login'); END IF;
    RETURN jsonb_build_object('ok',true);
  ELSIF operation='validate_session' THEN
    RETURN customer_auth.validate_session(payload->>'kind',payload->>'token_hash');
  ELSIF operation='revoke_session' THEN
    UPDATE customer_auth.customer_sessions SET revoked_at=now() WHERE token_hash=payload->>'token_hash' AND customer_sessions.kind=payload->>'kind';
    RETURN jsonb_build_object('ok',true);
  ELSIF operation='audit_admin_failure' THEN
    INSERT INTO customer_auth.customer_audit_logs(action) VALUES('failed_admin_login');
    RETURN jsonb_build_object('ok',true);
  ELSIF operation IN ('set_user_active','rotate_shared','add_user') THEN
    -- Re-authorize and lock the administrator at the mutation boundary.
    SELECT aa.* INTO a FROM customer_auth.customer_admins aa JOIN customer_auth.customer_sessions s ON s.admin_id=aa.id
      WHERE s.token_hash=payload->>'admin_token_hash' AND s.kind='admin' AND s.revoked_at IS NULL AND s.expires_at>now()
        AND aa.active AND aa.session_version=s.principal_version AND aa.credential_version=s.credential_version FOR UPDATE OF aa,s;
    IF a.id IS NULL THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE='42501'; END IF;
    IF operation='rotate_shared' THEN
      UPDATE customer_auth.customer_credentials SET password_hash=payload->>'password_hash',updated_by=a.id WHERE customer_credentials.kind='shared';
      GET DIAGNOSTICS affected=ROW_COUNT;
      IF affected<>1 THEN RAISE EXCEPTION 'Credential unavailable'; END IF;
      INSERT INTO customer_auth.customer_audit_logs(actor_admin_id,action) VALUES(a.id,'shared_password_changed');
    ELSIF operation='add_user' THEN
      INSERT INTO customer_auth.customer_users(employee_number) VALUES(payload->>'employee_number') RETURNING * INTO u;
      INSERT INTO customer_auth.customer_audit_logs(actor_admin_id,action,target_user_id) VALUES(a.id,'employee_added',u.id);
    ELSE
      IF jsonb_typeof(payload->'active') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'Invalid active state'; END IF;
      UPDATE customer_auth.customer_users SET active=(payload->>'active')::boolean WHERE id=(payload->>'user_id')::uuid RETURNING * INTO u;
      IF u.id IS NULL THEN RAISE EXCEPTION 'User unavailable'; END IF;
      INSERT INTO customer_auth.customer_audit_logs(actor_admin_id,action,target_user_id) VALUES(a.id,CASE WHEN u.active THEN 'employee_activated' ELSE 'employee_disabled' END,u.id);
    END IF;
    RETURN jsonb_build_object('ok',true);
  END IF;
  RAISE EXCEPTION 'Unsupported operation';
END $$;

-- public contains only this server-only bridge, NOT auth tables or exposed credentials.
CREATE FUNCTION public.customer_auth_rpc(operation text,payload jsonb) RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT customer_auth.rpc(operation,payload)
$$;
REVOKE ALL ON ALL TABLES IN SCHEMA customer_auth FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA customer_auth FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.customer_auth_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_auth_rpc(text,jsonb), customer_auth.rpc(text,jsonb), customer_auth.validate_session(text,text) TO service_role;
GRANT SELECT,INSERT,UPDATE ON customer_auth.customer_users,customer_auth.customer_credentials,customer_auth.customer_admins,customer_auth.customer_sessions,customer_auth.customer_login_limits TO service_role;
GRANT SELECT,INSERT ON customer_auth.customer_audit_logs TO service_role;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['customer_users','customer_credentials','customer_admins','customer_sessions','customer_audit_logs','customer_login_limits'] LOOP
    EXECUTE format('ALTER TABLE customer_auth.%I ENABLE ROW LEVEL SECURITY',tab);
    EXECUTE format('CREATE POLICY customer_server_only ON customer_auth.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',tab);
  END LOOP;
END $$;
COMMIT;
