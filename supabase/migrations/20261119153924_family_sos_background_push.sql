BEGIN;

-- Endpoints, encryption keys, sessions and delivery leases are never exposed
-- through the Data API. Client RPCs operate only on the current user's device.
CREATE TABLE IF NOT EXISTS safewatch_private.family_push_config (
  singleton BOOLEAN PRIMARY KEY DEFAULT true CHECK(singleton),
  public_key TEXT,
  function_url TEXT
);
INSERT INTO safewatch_private.family_push_config(singleton) VALUES(true) ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS safewatch_private.family_push_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES auth.sessions(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth_key TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS family_push_user ON safewatch_private.family_push_subscriptions(user_id) WHERE enabled;
CREATE TABLE IF NOT EXISTS safewatch_private.family_push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL REFERENCES safewatch_private.family_push_subscriptions(id) ON DELETE CASCADE,
  alert_id BIGINT REFERENCES public.alerts(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('sos','test')),
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','cancelled','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  locked_at TIMESTAMPTZ,
  lease UUID,
  last_status INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()+interval '5 minutes',
  UNIQUE(alert_id,subscription_id),
  CHECK((kind='sos' AND alert_id IS NOT NULL) OR (kind='test' AND alert_id IS NULL))
);
CREATE INDEX IF NOT EXISTS family_push_due ON safewatch_private.family_push_deliveries(next_attempt_at) WHERE state IN ('pending','sending');
ALTER TABLE safewatch_private.family_push_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE safewatch_private.family_push_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE safewatch_private.family_push_deliveries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON safewatch_private.family_push_config,safewatch_private.family_push_subscriptions,safewatch_private.family_push_deliveries FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION safewatch_private.family_push_allowed(p_user UUID,p_session UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT EXISTS(
  SELECT 1 FROM public.safewatch_account_access a JOIN auth.users u ON u.id=a.user_id
  JOIN auth.sessions s ON s.user_id=u.id AND s.id=p_session
  WHERE a.user_id=p_user AND a.role='family' AND a.status='approved'
    AND u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
    AND (u.banned_until IS NULL OR u.banned_until<now()) AND (s.not_after IS NULL OR s.not_after>now())
    AND (s.aal::text='aal2' OR NOT EXISTS(SELECT 1 FROM auth.mfa_factors f WHERE f.user_id=u.id AND f.status='verified'))
    AND EXISTS(SELECT 1 FROM public.safewatch_privacy_acceptances r WHERE r.user_id=u.id
      AND r.app=a.requested_app AND r.stage='first_login' AND r.version='2026-10-29' AND r.terms_accepted AND r.account_consent)
) $$;
REVOKE ALL ON FUNCTION safewatch_private.family_push_allowed(UUID,UUID) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION safewatch_private.family_push_configuration()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE key TEXT; BEGIN
  IF NOT public.safewatch_has_app_access('family') THEN RAISE EXCEPTION 'Approved family access is required' USING ERRCODE='42501'; END IF;
  SELECT public_key INTO key FROM safewatch_private.family_push_config WHERE singleton;
  RETURN jsonb_build_object('publicKey',key);
END $$;
CREATE OR REPLACE FUNCTION public.family_push_configuration()
RETURNS JSONB LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT safewatch_private.family_push_configuration() $$;

CREATE OR REPLACE FUNCTION safewatch_private.save_family_push_subscription(p_subscription JSONB,p_expected_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE current_user_id UUID:=auth.uid(); current_session UUID; saved_id UUID; BEGIN
  IF current_user_id IS NULL OR p_expected_user_id IS DISTINCT FROM current_user_id OR NOT public.safewatch_has_app_access('family') THEN
    RAISE EXCEPTION 'Approved family access is required' USING ERRCODE='42501'; END IF;
  current_session:=NULLIF(auth.jwt()->>'session_id','')::uuid;
  IF NOT safewatch_private.family_push_allowed(current_user_id,current_session) THEN RAISE EXCEPTION 'Sign in again to enable notifications' USING ERRCODE='42501'; END IF;
  IF p_subscription IS NULL OR jsonb_typeof(p_subscription)<>'object'
    OR length(COALESCE(p_subscription->>'endpoint',''))>2048
    OR COALESCE(p_subscription->>'endpoint','') !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|web[.]push[.]apple[.]com)/[A-Za-z0-9_./=:-]+$'
    OR COALESCE(p_subscription->'keys'->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}$'
    OR COALESCE(p_subscription->'keys'->>'auth','') !~ '^[A-Za-z0-9_-]{22}$' THEN
    RAISE EXCEPTION 'Invalid push subscription' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('push:'||current_user_id::text,0));
  IF (SELECT count(*) FROM safewatch_private.family_push_subscriptions WHERE user_id=current_user_id AND enabled)>=10
      AND NOT EXISTS(SELECT 1 FROM safewatch_private.family_push_subscriptions WHERE endpoint=p_subscription->>'endpoint' AND user_id=current_user_id) THEN
    RAISE EXCEPTION 'Turn off notifications on an older device before adding another' USING ERRCODE='22023'; END IF;
  INSERT INTO safewatch_private.family_push_subscriptions(user_id,session_id,endpoint,p256dh,auth_key)
    VALUES(current_user_id,current_session,p_subscription->>'endpoint',p_subscription->'keys'->>'p256dh',p_subscription->'keys'->>'auth')
    ON CONFLICT(endpoint) DO UPDATE SET session_id=EXCLUDED.session_id,p256dh=EXCLUDED.p256dh,auth_key=EXCLUDED.auth_key,enabled=true,updated_at=clock_timestamp()
      WHERE family_push_subscriptions.user_id=current_user_id
    RETURNING id INTO saved_id;
  IF saved_id IS NULL THEN RAISE EXCEPTION 'Turn off notifications for the previous account before enabling them' USING ERRCODE='42501'; END IF;
  RETURN saved_id;
END $$;
CREATE OR REPLACE FUNCTION public.save_family_push_subscription(p_subscription JSONB,p_expected_user_id UUID)
RETURNS UUID LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT safewatch_private.save_family_push_subscription(p_subscription,p_expected_user_id) $$;

CREATE OR REPLACE FUNCTION safewatch_private.remove_family_push_subscription(p_endpoint TEXT)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to change notifications' USING ERRCODE='42501'; END IF;
  DELETE FROM safewatch_private.family_push_subscriptions WHERE user_id=auth.uid() AND endpoint=p_endpoint;
END $$;
CREATE OR REPLACE FUNCTION public.remove_family_push_subscription(p_endpoint TEXT)
RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT safewatch_private.remove_family_push_subscription(p_endpoint) $$;

CREATE OR REPLACE FUNCTION safewatch_private.request_family_push_test(p_subscription_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE delivery UUID; BEGIN
  IF NOT public.safewatch_has_app_access('family') OR NOT EXISTS(SELECT 1 FROM safewatch_private.family_push_subscriptions s
    WHERE s.id=p_subscription_id AND s.user_id=auth.uid() AND s.enabled AND safewatch_private.family_push_allowed(s.user_id,s.session_id)) THEN
    RAISE EXCEPTION 'Enable notifications on this device first' USING ERRCODE='42501'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('push-test:'||auth.uid()::text,0));
  IF EXISTS(SELECT 1 FROM safewatch_private.family_push_deliveries d JOIN safewatch_private.family_push_subscriptions s ON s.id=d.subscription_id
      WHERE s.user_id=auth.uid() AND d.kind='test' AND d.created_at>clock_timestamp()-interval '1 minute') THEN
    RAISE EXCEPTION 'Wait a minute before sending another test notification' USING ERRCODE='22023'; END IF;
  INSERT INTO safewatch_private.family_push_deliveries(subscription_id,kind,next_attempt_at)
    VALUES(p_subscription_id,'test',clock_timestamp()+interval '15 seconds') RETURNING id INTO delivery;
  RETURN delivery;
END $$;
CREATE OR REPLACE FUNCTION public.request_family_push_test(p_subscription_id UUID)
RETURNS UUID LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
AS $$ SELECT safewatch_private.request_family_push_test(p_subscription_id) $$;

REVOKE ALL ON FUNCTION safewatch_private.family_push_configuration(),public.family_push_configuration(),
  safewatch_private.save_family_push_subscription(JSONB,UUID),public.save_family_push_subscription(JSONB,UUID),
  safewatch_private.remove_family_push_subscription(TEXT),public.remove_family_push_subscription(TEXT),
  safewatch_private.request_family_push_test(UUID),public.request_family_push_test(UUID) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION safewatch_private.family_push_configuration(),public.family_push_configuration(),
  safewatch_private.save_family_push_subscription(JSONB,UUID),public.save_family_push_subscription(JSONB,UUID),
  safewatch_private.remove_family_push_subscription(TEXT),public.remove_family_push_subscription(TEXT),
  safewatch_private.request_family_push_test(UUID),public.request_family_push_test(UUID) TO authenticated;

-- The alert write only inserts a local outbox row. No HTTP request, geocoding,
-- encryption or delivery retry runs in the watch ingestion transaction.
CREATE OR REPLACE FUNCTION safewatch_private.enqueue_family_sos_push()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ BEGIN
  IF NEW.alert_type='SOS' AND NEW.details->>'sos_family_first'='true'
      AND NEW.details->>'status'='PENDING_FAMILY' AND NEW.details->>'incident_open' IS DISTINCT FROM 'false' THEN
    INSERT INTO safewatch_private.family_push_deliveries(subscription_id,alert_id,kind)
      SELECT s.id,NEW.id,'sos' FROM safewatch_private.family_push_subscriptions s
      JOIN public.family_seniors f ON f.user_id=s.user_id AND f.device_id=NEW.device_id
      WHERE s.enabled AND safewatch_private.family_push_allowed(s.user_id,s.session_id)
      ON CONFLICT(alert_id,subscription_id) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION safewatch_private.enqueue_family_sos_push() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS safewatch_family_sos_push ON public.alerts;
CREATE TRIGGER safewatch_family_sos_push AFTER INSERT ON public.alerts FOR EACH ROW EXECUTE FUNCTION safewatch_private.enqueue_family_sos_push();

CREATE OR REPLACE FUNCTION safewatch_private.family_push_delivery_allowed(p_delivery safewatch_private.family_push_deliveries)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT p_delivery.expires_at>now() AND EXISTS(
  SELECT 1 FROM safewatch_private.family_push_subscriptions s WHERE s.id=p_delivery.subscription_id AND s.enabled
    AND safewatch_private.family_push_allowed(s.user_id,s.session_id)
    AND (p_delivery.kind='test' OR EXISTS(SELECT 1 FROM public.alerts a JOIN public.family_seniors f ON f.device_id=a.device_id AND f.user_id=s.user_id
      JOIN public.devices w ON w.id=a.device_id AND w.patient_name<>'[HIDDEN]'
      WHERE a.id=p_delivery.alert_id AND a.alert_type='SOS' AND a.details->>'incident_open' IS DISTINCT FROM 'false'
        AND COALESCE(a.details->>'status','PENDING_FAMILY') IN ('PENDING_FAMILY','ESCALATED_BHW')
        AND NOT COALESCE(a.details->'sos_responses','{}'::jsonb) ? 'family'))
) $$;
REVOKE ALL ON FUNCTION safewatch_private.family_push_delivery_allowed(safewatch_private.family_push_deliveries) FROM PUBLIC,anon,authenticated,service_role;

-- Only the authenticated sender can claim private endpoint material. The
-- dedicated random dispatcher token is encrypted in Vault, never in cron SQL.
CREATE OR REPLACE FUNCTION public.claim_family_sos_push(p_token TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE expected TEXT; vapid JSONB; row safewatch_private.family_push_deliveries; sub safewatch_private.family_push_subscriptions;
  batch JSONB:='[]'::jsonb; current_lease UUID; BEGIN
  SELECT decrypted_secret INTO expected FROM vault.decrypted_secrets WHERE name='safewatch_family_push_dispatch';
  IF expected IS NULL OR p_token IS NULL OR p_token<>expected THEN RAISE EXCEPTION 'Invalid dispatcher' USING ERRCODE='42501'; END IF;
  SELECT decrypted_secret::jsonb INTO vapid FROM vault.decrypted_secrets WHERE name='safewatch_family_push_vapid';
  IF vapid IS NULL THEN RAISE EXCEPTION 'Push sender is not configured'; END IF;
  FOR row IN SELECT * FROM safewatch_private.family_push_deliveries
    WHERE (state='pending' AND next_attempt_at<=clock_timestamp()) OR (state='sending' AND locked_at<clock_timestamp()-interval '2 minutes')
    ORDER BY next_attempt_at LIMIT 40 FOR UPDATE SKIP LOCKED
  LOOP
    IF row.attempts>=5 OR NOT safewatch_private.family_push_delivery_allowed(row) THEN
      UPDATE safewatch_private.family_push_deliveries SET state='cancelled',lease=NULL WHERE id=row.id; CONTINUE;
    END IF;
    current_lease:=gen_random_uuid();
    UPDATE safewatch_private.family_push_deliveries SET state='sending',attempts=attempts+1,locked_at=clock_timestamp(),lease=current_lease WHERE id=row.id;
    SELECT * INTO sub FROM safewatch_private.family_push_subscriptions WHERE id=row.subscription_id;
    batch:=batch||jsonb_build_array(jsonb_build_object('id',row.id,'lease',current_lease,
      'subscription',jsonb_build_object('endpoint',sub.endpoint,'keys',jsonb_build_object('p256dh',sub.p256dh,'auth',sub.auth_key)),
      'payload',jsonb_build_object('kind',row.kind,'deliveryId',row.id,'userId',sub.user_id,'alertId',row.alert_id::text,'createdAt',row.created_at,'expiresAt',row.expires_at)));
  END LOOP;
  RETURN jsonb_build_object('vapid',vapid,'deliveries',batch);
END $$;

CREATE OR REPLACE FUNCTION public.family_push_delivery_current(p_id UUID,p_lease UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog
AS $$ SELECT EXISTS(SELECT 1 FROM safewatch_private.family_push_deliveries d WHERE d.id=p_id AND d.lease=p_lease
  AND d.state='sending' AND safewatch_private.family_push_delivery_allowed(d)) $$;

CREATE OR REPLACE FUNCTION public.finish_family_sos_push(p_id UUID,p_lease UUID,p_result TEXT,p_status INTEGER DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$ DECLARE sub_id UUID; BEGIN
  IF p_result NOT IN ('sent','retry','expired','cancelled','failed') THEN RAISE EXCEPTION 'Invalid delivery result'; END IF;
  UPDATE safewatch_private.family_push_deliveries SET
    state=CASE WHEN p_result='retry' AND attempts<5 AND expires_at>clock_timestamp() THEN 'pending'
      WHEN p_result='sent' THEN 'sent' WHEN p_result='cancelled' THEN 'cancelled' ELSE 'failed' END,
    next_attempt_at=clock_timestamp()+least(60,power(2,attempts)::integer*5)*interval '1 second',lease=NULL,last_status=p_status
    WHERE id=p_id AND lease=p_lease AND state='sending' RETURNING subscription_id INTO sub_id;
  IF p_result='expired' AND sub_id IS NOT NULL THEN UPDATE safewatch_private.family_push_subscriptions SET enabled=false WHERE id=sub_id; END IF;
END $$;
REVOKE ALL ON FUNCTION public.claim_family_sos_push(TEXT),public.family_push_delivery_current(UUID,UUID),public.finish_family_sos_push(UUID,UUID,TEXT,INTEGER) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.claim_family_sos_push(TEXT),public.family_push_delivery_current(UUID,UUID),public.finish_family_sos_push(UUID,UUID,TEXT,INTEGER) TO service_role;

-- BEGIN HOSTED PUSH DISPATCH
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
CREATE OR REPLACE FUNCTION safewatch_private.dispatch_family_sos_push()
RETURNS VOID LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$ DECLARE target TEXT; secret TEXT; BEGIN
  IF NOT EXISTS(SELECT 1 FROM safewatch_private.family_push_deliveries WHERE
    (state='pending' AND next_attempt_at<=clock_timestamp()) OR (state='sending' AND locked_at<clock_timestamp()-interval '2 minutes')) THEN RETURN; END IF;
  SELECT function_url INTO target FROM safewatch_private.family_push_config WHERE singleton;
  SELECT decrypted_secret INTO secret FROM vault.decrypted_secrets WHERE name='safewatch_family_push_dispatch';
  IF target IS NULL OR secret IS NULL THEN RETURN; END IF;
  PERFORM net.http_post(url:=target,headers:=jsonb_build_object('Content-Type','application/json','x-safewatch-push-token',secret),body:='{}'::jsonb,timeout_milliseconds:=60000);
END $$;
REVOKE ALL ON FUNCTION safewatch_private.dispatch_family_sos_push() FROM PUBLIC,anon,authenticated,service_role;
SELECT cron.schedule('safewatch-family-sos-push','5 seconds','SELECT safewatch_private.dispatch_family_sos_push();');
SELECT cron.schedule('safewatch-family-push-retention','25 0 * * *',$job$
  DELETE FROM safewatch_private.family_push_deliveries WHERE created_at<clock_timestamp()-interval '3 days';
  DELETE FROM cron.job_run_details WHERE jobid IN (SELECT jobid FROM cron.job WHERE jobname='safewatch-family-sos-push') AND end_time<clock_timestamp()-interval '3 days';
$job$);
-- END HOSTED PUSH DISPATCH
NOTIFY pgrst,'reload schema';
COMMIT;
