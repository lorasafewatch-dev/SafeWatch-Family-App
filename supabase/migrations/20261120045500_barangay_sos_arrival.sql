BEGIN;

CREATE OR REPLACE FUNCTION public.mark_sos_arrived(p_alert_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
DECLARE
  target public.alerts;
  watch_id UUID;
  arrived_at TIMESTAMPTZ;
BEGIN
  IF NOT public.safewatch_has_app_access('dashboard') THEN
    RAISE EXCEPTION 'Approved barangay access is required' USING ERRCODE='42501';
  END IF;
  SELECT device_id INTO watch_id FROM public.alerts WHERE id=p_alert_id AND alert_type='SOS';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'This SOS is unavailable. Refresh alerts.' USING ERRCODE='40001';
  END IF;
  -- Use the same lock order as respond_to_sos and watch removal.
  PERFORM pg_advisory_xact_lock(hashtextextended(watch_id::text,0));
  PERFORM 1 FROM public.devices WHERE id=watch_id AND patient_name<>'[HIDDEN]' FOR UPDATE;
  IF NOT FOUND OR NOT public.safewatch_has_app_access('dashboard') THEN
    RAISE EXCEPTION 'This SOS is unavailable' USING ERRCODE='42501';
  END IF;
  SELECT * INTO target FROM public.alerts WHERE id=p_alert_id AND device_id=watch_id AND alert_type='SOS' FOR UPDATE;
  IF NOT FOUND OR NOT safewatch_private.sos_staff_visible(target.details)
    OR target.details->>'status' IS DISTINCT FROM 'ACKNOWLEDGED_BHW' THEN
    RAISE EXCEPTION 'Barangay must accept this SOS before reporting arrival' USING ERRCODE='40001';
  END IF;
  IF target.details->>'sos_arrived_at' IS NOT NULL THEN
    RETURN jsonb_build_object('saved',true,'alert',to_jsonb(target));
  END IF;

  arrived_at:=clock_timestamp();
  UPDATE public.alerts SET details=details||jsonb_build_object(
    'sos_arrived_at',arrived_at,'sos_arrived_by',auth.uid(),'sos_response_at',arrived_at,
    'sos_response_version',COALESCE((details->>'sos_response_version')::integer,0)+1)
    WHERE id=p_alert_id RETURNING * INTO target;
  RETURN jsonb_build_object('saved',true,'alert',to_jsonb(target));
END;
$$;
REVOKE ALL ON FUNCTION public.mark_sos_arrived(BIGINT) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.mark_sos_arrived(BIGINT) TO authenticated;

ALTER TABLE safewatch_private.family_push_deliveries DROP CONSTRAINT family_push_delivery_kind_alert_check;
ALTER TABLE safewatch_private.family_push_deliveries
  ADD CONSTRAINT family_push_delivery_kind_alert_check CHECK (
    (kind IN ('sos','barangay_on_the_way','barangay_arrived') AND alert_id IS NOT NULL)
    OR (kind='test' AND alert_id IS NULL));

CREATE OR REPLACE FUNCTION safewatch_private.enqueue_barangay_response_push()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$ BEGIN
  IF OLD.details->>'status'='ACKNOWLEDGED_BHW' AND OLD.details->>'sos_arrived_at' IS NULL
    AND NEW.details->>'sos_arrived_at' IS NOT NULL THEN
    PERFORM safewatch_private.queue_family_sos_push(NEW.id,NEW.device_id,0,'barangay_arrived');
  ELSIF COALESCE(OLD.details->>'status','PENDING_FAMILY') IN ('PENDING_FAMILY','ESCALATED_BHW') THEN
    PERFORM safewatch_private.queue_family_sos_push(NEW.id,NEW.device_id,0,'barangay_on_the_way');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS alerts_barangay_response_push ON public.alerts;
CREATE TRIGGER alerts_barangay_response_push AFTER UPDATE OF details ON public.alerts FOR EACH ROW
  WHEN (NEW.alert_type='SOS' AND NEW.details->>'status'='ACKNOWLEDGED_BHW'
    AND (OLD.details->>'status' IS DISTINCT FROM NEW.details->>'status'
      OR OLD.details->>'sos_arrived_at' IS DISTINCT FROM NEW.details->>'sos_arrived_at'))
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
          WHEN 'barangay_arrived' THEN a.details->>'status'='ACKNOWLEDGED_BHW'
            AND a.details->>'sos_arrived_at' IS NOT NULL
          WHEN 'barangay_on_the_way' THEN a.details->>'status'='ACKNOWLEDGED_BHW'
            AND a.details->>'sos_arrived_at' IS NULL
          WHEN 'sos' THEN a.details->>'incident_open' IS DISTINCT FROM 'false'
            AND a.details->>'status' IN ('PENDING_FAMILY','ESCALATED_BHW')
            AND (p_delivery.activation_packet_id>0 OR NOT coalesce(a.details->'sos_responses','{}'::jsonb) ? 'family')
          ELSE false
        END))
) $$;

COMMIT;
