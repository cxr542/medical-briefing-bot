BEGIN;
DO $$ BEGIN
  IF EXISTS(SELECT 1 FROM storage.buckets WHERE id IN ('support-quarantine','support-clean')) THEN
    RAISE EXCEPTION 'Attachment bucket already exists: review configuration before provisioning';
  END IF;
END $$;
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types) VALUES
  ('support-quarantine','support-quarantine',false,1048576,ARRAY['application/octet-stream']),
  ('support-clean','support-clean',false,10485760,ARRAY['image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);
CREATE POLICY support_attachment_private ON storage.objects AS RESTRICTIVE FOR ALL TO anon,authenticated
  USING(bucket_id NOT IN ('support-quarantine','support-clean'))
  WITH CHECK(bucket_id NOT IN ('support-quarantine','support-clean'));
COMMIT;
