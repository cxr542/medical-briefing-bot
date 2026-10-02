BEGIN;

CREATE SCHEMA running AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA running FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION running.valid_device(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN value IS NULL THEN true
    WHEN jsonb_typeof(value) <> 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(value) item
      WHERE item.key NOT IN ('manufacturer','model','hardware_version','software_version')
        OR jsonb_typeof(item.value) <> 'string'
        OR char_length(item.value #>> '{}') NOT BETWEEN 1 AND 128
        OR (item.value #>> '{}') ~ '[[:cntrl:]]'
    ) END;
$$;

CREATE FUNCTION running.valid_source_metadata(value jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path = pg_catalog AS $$
  SELECT CASE WHEN value IS NULL THEN true
    WHEN jsonb_typeof(value) <> 'object' THEN false
    ELSE NOT EXISTS (
      SELECT 1 FROM jsonb_each(value) item
      WHERE item.key NOT IN ('source_version','source_product_type','provider_activity_type','hr_method')
        OR jsonb_typeof(item.value) NOT IN ('string','number','boolean','null')
        OR (item.key = 'hr_method' AND (
          jsonb_typeof(item.value) <> 'string'
          OR item.value #>> '{}' NOT IN ('healthkit_statistics','provider_summary','manual')
        ))
    ) END;
$$;

CREATE TABLE running.profiles (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  onboarding_status text NOT NULL DEFAULT 'pending' CHECK (onboarding_status IN ('pending','complete')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE running.shoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES running.profiles(user_id) ON DELETE CASCADE,
  legacy_local_id text,
  legacy_created_at timestamptz CHECK (legacy_created_at IS NULL OR isfinite(legacy_created_at)),
  nickname text NOT NULL,
  brand text,
  model text,
  traits text,
  recommendation text NOT NULL DEFAULT '',
  photo_source text CHECK (photo_source IN ('camera','album')),
  gemini_analyzed boolean,
  seed_file text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,id),
  UNIQUE (user_id,legacy_local_id)
);

CREATE TABLE running.import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES running.profiles(user_id) ON DELETE CASCADE,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  source text NOT NULL CHECK (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  received_count integer NOT NULL CHECK (received_count BETWEEN 1 AND 100),
  inserted_count integer NOT NULL DEFAULT 0 CHECK (inserted_count >= 0),
  updated_count integer NOT NULL DEFAULT 0 CHECK (updated_count >= 0),
  skipped_count integer NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count >= 0),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','partial','failed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,id),
  UNIQUE (user_id,id,source),
  CHECK (isfinite(started_at) AND (finished_at IS NULL OR (isfinite(finished_at) AND finished_at >= started_at))),
  CHECK (inserted_count::bigint + updated_count + skipped_count + failed_count <= received_count),
  CHECK ((status IN ('pending','processing') AND finished_at IS NULL)
    OR (status IN ('completed','partial','failed') AND finished_at IS NOT NULL
      AND inserted_count::bigint + updated_count + skipped_count + failed_count = received_count)),
  CHECK (status <> 'completed' OR failed_count = 0),
  CHECK (status <> 'partial' OR (failed_count > 0 AND failed_count < received_count)),
  CHECK (status <> 'failed' OR failed_count = received_count)
);

CREATE TABLE running.workouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES running.profiles(user_id) ON DELETE CASCADE,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  source text NOT NULL CHECK (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  external_id text NOT NULL CHECK (char_length(external_id) BETWEEN 1 AND 512 AND length(btrim(external_id)) > 0 AND external_id !~ '[[:cntrl:]]'),
  healthkit_uuid uuid,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  duration_seconds numeric(12,3) NOT NULL CHECK (duration_seconds > 0 AND duration_seconds < 1000000000),
  duration_basis text NOT NULL CHECK (duration_basis IN ('active','elapsed','unknown')),
  distance_meters numeric(12,3) CHECK (distance_meters >= 0 AND distance_meters < 1000000000),
  active_calories numeric(10,3) CHECK (active_calories >= 0 AND active_calories < 10000000),
  avg_heart_rate numeric(6,2) CHECK (avg_heart_rate > 0 AND avg_heart_rate < 10000),
  max_heart_rate numeric(6,2) CHECK (max_heart_rate > 0 AND max_heart_rate < 10000),
  avg_pace_seconds_per_km numeric GENERATED ALWAYS AS (
    CASE WHEN distance_meters > 0 THEN duration_seconds * 1000 / distance_meters ELSE NULL END
  ) STORED,
  sport_type text NOT NULL DEFAULT 'running' CHECK (sport_type = 'running'),
  is_indoor boolean,
  source_app text CHECK (char_length(source_app) BETWEEN 1 AND 255 AND source_app !~ '[[:cntrl:]]'),
  device jsonb CHECK (running.valid_device(device) AND octet_length(device::text) <= 2048),
  source_metadata jsonb CHECK (running.valid_source_metadata(source_metadata) AND octet_length(source_metadata::text) <= 8192),
  import_batch_id uuid,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision >= 1),
  deleted_at timestamptz CHECK (deleted_at IS NULL OR isfinite(deleted_at)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id,id),
  UNIQUE (user_id,source,external_id),
  CHECK (isfinite(started_at) AND isfinite(ended_at) AND ended_at > started_at),
  CHECK (duration_seconds <= extract(epoch FROM ended_at - started_at) + 1),
  CHECK (avg_heart_rate IS NULL OR max_heart_rate IS NULL OR max_heart_rate >= avg_heart_rate),
  CHECK ((source = 'healthkit' AND healthkit_uuid IS NOT NULL AND external_id = healthkit_uuid::text)
    OR (source <> 'healthkit' AND healthkit_uuid IS NULL)),
  CHECK (source <> 'manual' OR external_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  FOREIGN KEY (user_id,import_batch_id,source)
    REFERENCES running.import_batches(user_id,id,source)
    ON DELETE SET NULL (import_batch_id)
);

CREATE TABLE running.workout_shoes (
  user_id uuid NOT NULL REFERENCES running.profiles(user_id) ON DELETE CASCADE,
  workout_id uuid NOT NULL,
  shoe_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id,workout_id,shoe_id),
  FOREIGN KEY (user_id,workout_id) REFERENCES running.workouts(user_id,id) ON DELETE CASCADE,
  FOREIGN KEY (user_id,shoe_id) REFERENCES running.shoes(user_id,id) ON DELETE NO ACTION
);

CREATE INDEX workouts_user_started_idx ON running.workouts(user_id,started_at DESC);
CREATE INDEX workouts_user_batch_idx ON running.workouts(user_id,import_batch_id) WHERE import_batch_id IS NOT NULL;
CREATE INDEX shoes_user_created_idx ON running.shoes(user_id,created_at DESC);
CREATE INDEX workout_shoes_user_shoe_idx ON running.workout_shoes(user_id,shoe_id);
CREATE INDEX import_batches_user_started_idx ON running.import_batches(user_id,started_at DESC);

CREATE FUNCTION running.stamp_audit() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.created_at := clock_timestamp();
    IF TG_TABLE_NAME = 'workouts' THEN NEW.revision := 1; END IF;
  ELSE
    NEW.created_at := OLD.created_at;
    IF TG_TABLE_NAME = 'workouts' THEN NEW.revision := OLD.revision + 1; END IF;
  END IF;
  IF TG_TABLE_NAME <> 'workout_shoes' THEN NEW.updated_at := clock_timestamp(); END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER profiles_audit BEFORE INSERT OR UPDATE ON running.profiles FOR EACH ROW EXECUTE FUNCTION running.stamp_audit();
CREATE TRIGGER shoes_audit BEFORE INSERT OR UPDATE ON running.shoes FOR EACH ROW EXECUTE FUNCTION running.stamp_audit();
CREATE TRIGGER workouts_audit BEFORE INSERT OR UPDATE ON running.workouts FOR EACH ROW EXECUTE FUNCTION running.stamp_audit();
CREATE TRIGGER import_batches_audit BEFORE INSERT OR UPDATE ON running.import_batches FOR EACH ROW EXECUTE FUNCTION running.stamp_audit();
CREATE TRIGGER workout_shoes_audit BEFORE INSERT OR UPDATE ON running.workout_shoes FOR EACH ROW EXECUTE FUNCTION running.stamp_audit();

REVOKE ALL ON ALL TABLES IN SCHEMA running FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA running FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA running FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA running TO authenticated;
GRANT EXECUTE ON FUNCTION running.valid_device(jsonb), running.valid_source_metadata(jsonb) TO authenticated;
GRANT SELECT, DELETE ON running.profiles, running.shoes, running.workouts, running.workout_shoes, running.import_batches TO authenticated;
GRANT INSERT (user_id,display_name,status,onboarding_status) ON running.profiles TO authenticated;
GRANT UPDATE (display_name,status,onboarding_status) ON running.profiles TO authenticated;
GRANT INSERT (user_id,legacy_local_id,legacy_created_at,nickname,brand,model,traits,recommendation,photo_source,gemini_analyzed,seed_file) ON running.shoes TO authenticated;
GRANT UPDATE (nickname,brand,model,traits,recommendation,photo_source,gemini_analyzed,seed_file) ON running.shoes TO authenticated;
GRANT INSERT (user_id,schema_version,source,external_id,healthkit_uuid,started_at,ended_at,duration_seconds,duration_basis,distance_meters,active_calories,avg_heart_rate,max_heart_rate,sport_type,is_indoor,source_app,device,source_metadata,import_batch_id) ON running.workouts TO authenticated;
GRANT UPDATE (started_at,ended_at,duration_seconds,duration_basis,distance_meters,active_calories,avg_heart_rate,max_heart_rate,is_indoor,source_app,device,source_metadata,import_batch_id,deleted_at) ON running.workouts TO authenticated;
GRANT INSERT (user_id,workout_id,shoe_id) ON running.workout_shoes TO authenticated;
GRANT INSERT (id,user_id,schema_version,source,received_count) ON running.import_batches TO authenticated;
GRANT UPDATE (finished_at,inserted_count,updated_count,skipped_count,failed_count,status) ON running.import_batches TO authenticated;

ALTER TABLE running.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY profiles_select ON running.profiles FOR SELECT TO authenticated USING ((SELECT auth.uid()) = user_id);
CREATE POLICY profiles_insert ON running.profiles FOR INSERT TO authenticated WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY profiles_update ON running.profiles FOR UPDATE TO authenticated USING ((SELECT auth.uid()) = user_id) WITH CHECK ((SELECT auth.uid()) = user_id);
CREATE POLICY profiles_delete ON running.profiles FOR DELETE TO authenticated USING ((SELECT auth.uid()) = user_id);

DO $policies$
DECLARE
  name text;
  predicate text := '(SELECT auth.uid()) = user_id AND EXISTS (SELECT 1 FROM running.profiles p WHERE p.user_id = (SELECT auth.uid()) AND p.status = ''active'')';
BEGIN
  FOREACH name IN ARRAY ARRAY['shoes','workouts','workout_shoes','import_batches'] LOOP
    EXECUTE format('ALTER TABLE running.%I ENABLE ROW LEVEL SECURITY',name);
    EXECUTE format('CREATE POLICY %I ON running.%I FOR SELECT TO authenticated USING (%s)',name || '_select',name,predicate);
    EXECUTE format('CREATE POLICY %I ON running.%I FOR INSERT TO authenticated WITH CHECK (%s)',name || '_insert',name,predicate);
    EXECUTE format('CREATE POLICY %I ON running.%I FOR UPDATE TO authenticated USING (%s) WITH CHECK (%s)',name || '_update',name,predicate,predicate);
    EXECUTE format('CREATE POLICY %I ON running.%I FOR DELETE TO authenticated USING (%s)',name || '_delete',name,predicate);
  END LOOP;
END
$policies$;

COMMIT;
