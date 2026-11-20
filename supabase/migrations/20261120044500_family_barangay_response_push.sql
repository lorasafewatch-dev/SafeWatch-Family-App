BEGIN;

ALTER TABLE safewatch_private.family_push_deliveries
  DROP CONSTRAINT IF EXISTS family_push_deliveries_kind_check,
  DROP CONSTRAINT IF EXISTS family_push_deliveries_check,
  DROP CONSTRAINT IF EXISTS family_push_delivery_kind_alert_check;
ALTER TABLE safewatch_private.family_push_deliveries
  ADD CONSTRAINT family_push_delivery_kind_alert_check CHECK (
    (kind IN ('sos','barangay_on_the_way') AND alert_id IS NOT NULL)
    OR (kind='test' AND alert_id IS NULL));

-- A confirmation has its own delivery even if the initial SOS was already sent.
CREATE UNIQUE INDEX IF NOT EXISTS family_push_delivery_per_kind_activation
  ON safewatch_private.family_push_deliveries(alert_id,subscription_id,kind,activation_packet_id);
DROP INDEX IF EXISTS safewatch_private.family_push_delivery_per_activation;

DROP FUNCTION IF EXISTS safewatch_private.queue_family_sos_push(BIGINT,UUID,BIGINT);
CREATE OR REPLACE FUNCTION safewatch_private.queue_family_sos_push(
  p_alert_id BIGINT, p_device_id UUID, p_activation_packet_id BIGINT, p_kind TEXT DEFAULT 'sos')
RETURNS VOID LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog
AS $$
  INSERT INTO safewatch_private.family_push_deliveries(subscription_id,alert_id,kind,activation_packet_id)
  SELECT s.id,p_alert_id,p_kind,p_activation_packet_id
  FROM safewatch_private.family_push_subscriptions s
  JOIN public.family_seniors f ON f.user_id=s.user_id AND f.device_id=p_device_id
  WHERE s.enabled AND safewatch_private.family_push_allowed(s.user_id,s.session_id)
  ON CONFLICT(alert_id,subscription_id,kind,activation_packet_id) DO NOTHING
$$;
REVOKE ALL ON FUNCTION safewatch_private.queue_family_sos_push(BIGINT,UUID,BIGINT,TEXT) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION safewatch_private.enqueue_barangay_response_push()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$ BEGIN
  PERFORM safewatch_private.queue_family_sos_push(NEW.id,NEW.device_id,0,'barangay_on_the_way');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION safewatch_private.enqueue_barangay_response_push() FROM PUBLIC,anon,authenticated,service_role;

DROP TRIGGER IF EXISTS alerts_barangay_response_push ON public.alerts;
CREATE TRIGGER alerts_barangay_response_push AFTER UPDATE OF details ON public.alerts FOR EACH ROW
  WHEN (NEW.alert_type='SOS' AND NEW.details->>'status'='ACKNOWLEDGED_BHW'
    AND COALESCE(OLD.details->>'status','PENDING_FAMILY') IN ('PENDING_FAMILY','ESCALATED_BHW')
    AND NULLIF(NEW.details->>'sos_transferred_at','') IS NOT NULL)
  EXECUTE FUNCTION safewatch_private.enqueue_barangay_response_push();

CREATE OR REPLACE FUNCTION safewatch_private.family_push_delivery_allowed(p_delivery safewatch_private.family_push_deliveries)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public
AS $$ SELECT p_delivery.expires_at>now() AND EXISTS(
  SELECT 1 FROM safewatch_private.family_push_subscriptions s WHERE s.id=p_delivery.subscription_id AND s.enabled
    AND safewatch_private.family_push_allowed(s.user_id,s.session_id)
    AND (p_delivery.kind='test' OR EXISTS(
      SELECT 1 FROM public.alerts a
      JOIN public.family_seniors f ON f.device_id=a.device_id AND f.user_id=s.user_id
      JOIN public.devices w ON w.id=a.device_id AND w.patient_name<>'[HIDDEN]'
      WHERE a.id=p_delivery.alert_id AND a.alert_type='SOS'
        AND CASE p_delivery.kind
          WHEN 'barangay_on_the_way' THEN a.details->>'status'='ACKNOWLEDGED_BHW'
            AND NULLIF(a.details->>'sos_transferred_at','') IS NOT NULL
          WHEN 'sos' THEN a.details->>'incident_open' IS DISTINCT FROM 'false'
            AND a.details->>'status' IN ('PENDING_FAMILY','ESCALATED_BHW')
            AND (p_delivery.activation_packet_id>0 OR NOT coalesce(a.details->'sos_responses','{}'::jsonb) ? 'family')
          ELSE false
        END))
) $$;

COMMIT;
