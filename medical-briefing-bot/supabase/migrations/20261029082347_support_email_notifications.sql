BEGIN;

CREATE TABLE support.support_email_notifications (
  request_id uuid PRIMARY KEY REFERENCES support.support_requests(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'attempting' CHECK (status IN ('attempting','accepted','failed')),
  attempted_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
ALTER TABLE support.support_email_notifications ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON support.support_email_notifications FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON support.support_email_notifications TO service_role;

CREATE FUNCTION public.support_email_notification_rpc(operation text, request_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  CASE operation
    WHEN 'claim' THEN
      INSERT INTO support.support_email_notifications(request_id)
      SELECT r.id FROM support.support_requests r
      WHERE r.id = support_email_notification_rpc.request_id
        AND r.created_at > now() - interval '23 hours'
      ON CONFLICT DO NOTHING;
      RETURN FOUND;
    WHEN 'accepted', 'failed' THEN
      UPDATE support.support_email_notifications n
      SET status = operation, finished_at = now()
      WHERE n.request_id = support_email_notification_rpc.request_id AND n.status = 'attempting';
      RETURN FOUND;
    ELSE RAISE EXCEPTION 'Invalid notification operation' USING ERRCODE = '22023';
  END CASE;
END;
$$;
REVOKE ALL ON FUNCTION public.support_email_notification_rpc(text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.support_email_notification_rpc(text,uuid) TO service_role;

COMMIT;
