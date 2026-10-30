BEGIN;
CREATE TABLE customer_auth.customer_usage_start (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO customer_auth.customer_usage_start DEFAULT VALUES;
CREATE TABLE customer_auth.customer_usage_daily (
  user_id uuid NOT NULL REFERENCES customer_auth.customer_users(id),
  activity_date date NOT NULL,
  last_seen_at timestamptz NOT NULL,
  login_count bigint NOT NULL DEFAULT 0 CHECK (login_count >= 0),
  PRIMARY KEY (user_id, activity_date)
);
CREATE INDEX customer_usage_date ON customer_auth.customer_usage_daily(activity_date,user_id);
ALTER TABLE customer_auth.customer_usage_start ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_auth.customer_usage_daily ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON customer_auth.customer_usage_start,customer_auth.customer_usage_daily FROM PUBLIC,anon,authenticated,service_role;
GRANT SELECT ON customer_auth.customer_usage_start TO service_role;
GRANT SELECT,INSERT,UPDATE ON customer_auth.customer_usage_daily TO service_role;

CREATE FUNCTION customer_auth.record_usage(p_user uuid,p_login boolean) RETURNS void
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  INSERT INTO customer_auth.customer_usage_daily AS d(user_id,activity_date,last_seen_at,login_count)
  VALUES(p_user,(now() AT TIME ZONE 'Asia/Seoul')::date,now(),CASE WHEN p_login THEN 1 ELSE 0 END)
  ON CONFLICT (user_id,activity_date) DO UPDATE
  SET last_seen_at=greatest(d.last_seen_at,excluded.last_seen_at),login_count=d.login_count+excluded.login_count;
$$;
CREATE FUNCTION customer_auth.record_login_usage() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF NEW.kind='user' THEN PERFORM customer_auth.record_usage(NEW.user_id,true); END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER customer_session_usage AFTER INSERT ON customer_auth.customer_sessions
FOR EACH ROW EXECUTE FUNCTION customer_auth.record_login_usage();

CREATE FUNCTION public.customer_usage_rpc(operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE principal jsonb; first_day date; last_day date; grouping text; term text; page_number integer;
BEGIN
  IF operation='refresh_session' THEN
    principal:=public.customer_session_rpc(operation,payload);
    IF principal IS NOT NULL THEN PERFORM customer_auth.record_usage((principal->>'id')::uuid,false); END IF;
    RETURN principal;
  END IF;
  IF operation IS DISTINCT FROM 'list' THEN RAISE EXCEPTION 'Unsupported usage operation' USING ERRCODE='22023'; END IF;
  principal:=customer_auth.validate_session('admin',payload->>'admin_token_hash');
  IF principal IS NULL THEN RAISE EXCEPTION 'Admin required' USING ERRCODE='42501'; END IF;
  first_day:=(payload->>'from')::date; last_day:=(payload->>'to')::date;
  grouping:=payload->>'group'; term:=payload->>'search'; page_number:=(payload->>'page')::integer;
  IF first_day IS NULL OR last_day IS NULL OR last_day<first_day OR last_day-first_day>365
    OR grouping IS NULL OR grouping NOT IN ('day','week','month') OR term IS NULL OR length(term)>64
    OR page_number IS NULL OR page_number<1 OR page_number>100000 THEN
    RAISE EXCEPTION 'Invalid usage range' USING ERRCODE='22023';
  END IF;
  RETURN jsonb_build_object(
    'started_at',(SELECT started_at FROM customer_auth.customer_usage_start WHERE singleton),
    'from',first_day,'to',last_day,'group',grouping,'page',page_number,'page_size',20,
    'total',(SELECT count(*) FROM customer_auth.customer_users WHERE position(term IN employee_number)>0),
    'users',coalesce((SELECT jsonb_agg(to_jsonb(row) ORDER BY row.employee_number,row.id) FROM (
      SELECT u.id,u.employee_number,u.active,
        (SELECT max(d.last_seen_at) FROM customer_auth.customer_usage_daily d WHERE d.user_id=u.id) AS last_seen_at,
        (SELECT count(*) FROM customer_auth.customer_usage_daily d WHERE d.user_id=u.id AND d.activity_date BETWEEN first_day AND last_day) AS access_days,
        (SELECT coalesce(sum(d.login_count),0) FROM customer_auth.customer_usage_daily d WHERE d.user_id=u.id AND d.activity_date BETWEEN first_day AND last_day) AS login_count,
        coalesce((SELECT jsonb_agg(to_jsonb(b) ORDER BY b.period DESC) FROM (
          SELECT date_trunc(grouping,d.activity_date::timestamp)::date AS period,
            count(*) AS access_days,sum(d.login_count) AS login_count,max(d.last_seen_at) AS last_seen_at
          FROM customer_auth.customer_usage_daily d WHERE d.user_id=u.id AND d.activity_date BETWEEN first_day AND last_day
          GROUP BY 1
        ) b),'[]'::jsonb) AS periods
      FROM (SELECT id,employee_number,active FROM customer_auth.customer_users
        WHERE position(term IN employee_number)>0 ORDER BY employee_number,id LIMIT 20 OFFSET (page_number-1)*20) u
    ) row),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION customer_auth.record_usage(uuid,boolean),customer_auth.record_login_usage(),public.customer_usage_rpc(text,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION customer_auth.record_usage(uuid,boolean),customer_auth.record_login_usage(),public.customer_usage_rpc(text,jsonb) TO service_role;
COMMIT;
