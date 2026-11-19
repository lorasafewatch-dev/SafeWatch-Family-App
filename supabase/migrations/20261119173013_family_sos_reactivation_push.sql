BEGIN;

-- Zero identifies the first activation, including existing delivery receipts.
-- A later release and press uses the ID of the first new SOS packet.
ALTER TABLE safewatch_private.family_push_deliveries
  ADD COLUMN IF NOT EXISTS activation_packet_id BIGINT NOT NULL DEFAULT 0;
ALTER TABLE safewatch_private.family_push_deliveries
  DROP CONSTRAINT IF EXISTS family_push_deliveries_alert_id_subscription_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS family_push_delivery_per_activation
  ON safewatch_private.family_push_deliveries(alert_id,subscription_id,activation_packet_id);

CREATE OR REPLACE FUNCTION safewatch_private.queue_family_sos_push(
  p_alert_id BIGINT, p_device_id UUID, p_activation_packet_id BIGINT)
RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
AS $$
  INSERT INTO safewatch_private.family_push_deliveries(subscription_id,alert_id,kind,activation_packet_id)
  SELECT s.id,p_alert_id,'sos',p_activation_packet_id
  FROM safewatch_private.family_push_subscriptions s
  JOIN public.family_seniors f ON f.user_id=s.user_id AND f.device_id=p_device_id
  WHERE s.enabled AND safewatch_private.family_push_allowed(s.user_id,s.session_id)
  ON CONFLICT(alert_id,subscription_id,activation_packet_id) DO NOTHING
$$;
REVOKE ALL ON FUNCTION safewatch_private.queue_family_sos_push(BIGINT,UUID,BIGINT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION safewatch_private.enqueue_family_sos_push()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$ BEGIN
  IF NEW.alert_type='SOS' AND NEW.details->>'sos_family_first'='true'
      AND NEW.details->>'status'='PENDING_FAMILY' AND NEW.details->>'incident_open' IS DISTINCT FROM 'false' THEN
    PERFORM safewatch_private.queue_family_sos_push(NEW.id,NEW.device_id,0);
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION safewatch_private.enqueue_watch_sos_reactivation()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$ DECLARE incident_id BIGINT; BEGIN
  -- The existing telemetry trigger has opened or refreshed the incident and
  -- taken the watch's row lock before this trigger runs.
  SELECT a.id INTO incident_id
  FROM public.alerts a
  WHERE a.device_id=NEW.device_id AND a.alert_type='SOS'
    AND a.details->>'sos_family_first'='true' AND a.details->>'incident_open'='true'
    AND a.details->>'status' IN ('PENDING_FAMILY','ESCALATED_BHW')
    AND a.created_at<NEW.created_at
    AND EXISTS (
      SELECT 1
      FROM (
        SELECT last_two.id,
          lag(last_two.is_sos) OVER(ORDER BY last_two.observed_at,last_two.id) AS previous_sos,
          lag(last_two.created_at) OVER(ORDER BY last_two.observed_at,last_two.id) AS previous_received
        FROM (
          SELECT t.id,t.created_at,t.is_sos,coalesce(t.received_at,t.created_at) AS observed_at
          FROM public.telemetry t WHERE t.device_id=NEW.device_id
          ORDER BY coalesce(t.received_at,t.created_at) DESC,t.id DESC LIMIT 2
        ) last_two
      ) signal
      WHERE signal.id=NEW.id AND signal.previous_sos IS FALSE AND signal.previous_received>=a.created_at
    );
  IF FOUND THEN
    PERFORM safewatch_private.queue_family_sos_push(incident_id,NEW.device_id,NEW.id);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION safewatch_private.enqueue_watch_sos_reactivation() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS telemetry_sos_push_reactivation ON public.telemetry;
CREATE TRIGGER telemetry_sos_push_reactivation AFTER INSERT ON public.telemetry FOR EACH ROW
  WHEN (NEW.is_sos IS TRUE) EXECUTE FUNCTION safewatch_private.enqueue_watch_sos_reactivation();

CREATE OR REPLACE FUNCTION safewatch_private.family_push_delivery_allowed(p_delivery safewatch_private.family_push_deliveries)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT p_delivery.expires_at>now() AND EXISTS(
  SELECT 1 FROM safewatch_private.family_push_subscriptions s WHERE s.id=p_delivery.subscription_id AND s.enabled
    AND safewatch_private.family_push_allowed(s.user_id,s.session_id)
    AND (p_delivery.kind='test' OR EXISTS(SELECT 1 FROM public.alerts a JOIN public.family_seniors f ON f.device_id=a.device_id AND f.user_id=s.user_id
      JOIN public.devices w ON w.id=a.device_id AND w.patient_name<>'[HIDDEN]'
      WHERE a.id=p_delivery.alert_id AND a.alert_type='SOS' AND a.details->>'incident_open' IS DISTINCT FROM 'false'
        AND a.details->>'status' IN ('PENDING_FAMILY','ESCALATED_BHW')
        AND (p_delivery.activation_packet_id>0 OR NOT coalesce(a.details->'sos_responses','{}'::jsonb) ? 'family')))
) $$;

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
      'payload',jsonb_build_object('kind',row.kind,'deliveryId',row.id,'userId',sub.user_id,'alertId',row.alert_id::text,'reactivated',row.activation_packet_id>0,'createdAt',row.created_at,'expiresAt',row.expires_at)));
  END LOOP;
  RETURN jsonb_build_object('vapid',vapid,'deliveries',batch);
END $$;

COMMIT;
