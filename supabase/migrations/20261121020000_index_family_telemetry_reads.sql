BEGIN;

SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';

-- The Family app and last-fix lookup sort by server receipt time (created_at).
CREATE INDEX IF NOT EXISTS telemetry_device_created_recent
  ON public.telemetry (device_id, created_at DESC, id DESC);

COMMIT;
