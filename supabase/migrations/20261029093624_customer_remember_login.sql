BEGIN;
ALTER TABLE customer_auth.customer_sessions
  ADD COLUMN remember boolean NOT NULL DEFAULT false,
  ADD COLUMN last_seen_at timestamptz NOT NULL DEFAULT now();

-- Replace only the original lifetime check; principal and token checks stay intact.
DO $$ DECLARE constraint_name text; BEGIN
  SELECT conname INTO STRICT constraint_name FROM pg_constraint
  WHERE conrelid='customer_auth.customer_sessions'::regclass AND contype='c'
    AND pg_get_constraintdef(oid) LIKE '%expires_at%issued_at%';
  EXECUTE format('ALTER TABLE customer_auth.customer_sessions DROP CONSTRAINT %I', constraint_name);
END $$;
ALTER TABLE customer_auth.customer_sessions ADD CONSTRAINT customer_session_lifetime CHECK (
  expires_at > issued_at AND (
    (NOT remember AND expires_at <= issued_at + CASE WHEN kind='user' THEN interval '8 hours' ELSE interval '1 hour' END)
    OR (remember AND kind='user' AND last_seen_at >= issued_at AND expires_at <= last_seen_at + interval '30 days')
  )
);

-- Existing RPC remains available for old deployments and ordinary/admin login.
-- Opt-in issuance delegates its credential/version recheck to the existing RPC.
CREATE FUNCTION public.customer_session_rpc(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE result jsonb; session customer_auth.customer_sessions; principal uuid;
BEGIN
  IF operation='issue_session' THEN
    IF payload->>'kind' IS DISTINCT FROM 'user' OR payload->'remember' IS DISTINCT FROM 'true'::jsonb THEN
      RAISE EXCEPTION 'Invalid remembered session' USING ERRCODE='22023';
    END IF;
    result := customer_auth.rpc(operation,payload);
    IF result->'ok'='true'::jsonb THEN
      UPDATE customer_auth.customer_sessions SET remember=true,last_seen_at=now(),expires_at=now()+interval '30 days'
      WHERE token_hash=payload->>'token_hash' AND kind='user';
    END IF;
    RETURN result;
  ELSIF operation='refresh_session' THEN
    IF payload->>'kind' IS DISTINCT FROM 'user' THEN RETURN NULL; END IF;
    SELECT user_id INTO principal FROM customer_auth.customer_sessions
      WHERE token_hash=payload->>'token_hash' AND kind='user';
    IF principal IS NULL THEN RETURN NULL; END IF;
    -- Same lock order as issuance; password rotation, disable and logout cannot
    -- race renewal into reviving an invalid session.
    PERFORM 1 FROM customer_auth.customer_credentials WHERE kind='shared' FOR UPDATE;
    PERFORM 1 FROM customer_auth.customer_users WHERE id=principal FOR UPDATE;
    SELECT * INTO session FROM customer_auth.customer_sessions
      WHERE token_hash=payload->>'token_hash' AND kind='user' FOR UPDATE;
    result := customer_auth.validate_session('user',payload->>'token_hash');
    IF result IS NULL THEN RETURN NULL; END IF;
    IF session.remember THEN
      UPDATE customer_auth.customer_sessions SET last_seen_at=now(),expires_at=now()+interval '30 days'
        WHERE token_hash=session.token_hash RETURNING * INTO session;
    END IF;
    RETURN result || jsonb_build_object('remember',session.remember,'expires_at',session.expires_at);
  END IF;
  RAISE EXCEPTION 'Unsupported operation' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION public.customer_session_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.customer_session_rpc(text,jsonb) TO service_role;
COMMIT;
