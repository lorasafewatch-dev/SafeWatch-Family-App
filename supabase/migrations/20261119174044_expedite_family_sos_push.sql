BEGIN;

ALTER TABLE safewatch_private.family_push_deliveries ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ;

-- pg_net starts the HTTP request after commit. A failed wake-up leaves the
-- durable outbox intact for the existing five-second dispatcher to discover.
CREATE OR REPLACE FUNCTION safewatch_private.wake_family_push_dispatch()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog
AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM new_push_deliveries WHERE next_attempt_at<=clock_timestamp()) THEN
    BEGIN
      PERFORM safewatch_private.dispatch_family_sos_push();
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'SafeWatch push wake-up failed (%); scheduled dispatcher will retry', SQLSTATE;
    END;
  END IF;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION safewatch_private.wake_family_push_dispatch() FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS family_push_dispatch_after_insert ON safewatch_private.family_push_deliveries;
CREATE TRIGGER family_push_dispatch_after_insert
  AFTER INSERT ON safewatch_private.family_push_deliveries
  REFERENCING NEW TABLE AS new_push_deliveries
  FOR EACH STATEMENT EXECUTE FUNCTION safewatch_private.wake_family_push_dispatch();

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
  INSERT INTO safewatch_private.family_push_deliveries(subscription_id,kind)
    VALUES(p_subscription_id,'test') RETURNING id INTO delivery;
  RETURN delivery;
END $$;
CREATE OR REPLACE FUNCTION public.finish_family_sos_push(p_id UUID,p_lease UUID,p_result TEXT,p_status INTEGER DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog
AS $$ DECLARE sub_id UUID; BEGIN
  IF p_result NOT IN ('sent','retry','expired','cancelled','failed') THEN RAISE EXCEPTION 'Invalid delivery result'; END IF;
  UPDATE safewatch_private.family_push_deliveries SET
    state=CASE WHEN p_result='retry' AND attempts<5 AND expires_at>clock_timestamp() THEN 'pending'
      WHEN p_result='sent' THEN 'sent' WHEN p_result='cancelled' THEN 'cancelled' ELSE 'failed' END,
    next_attempt_at=clock_timestamp()+least(60,power(2,attempts)::integer*5)*interval '1 second',lease=NULL,last_status=p_status,finished_at=clock_timestamp()
    WHERE id=p_id AND lease=p_lease AND state='sending' RETURNING subscription_id INTO sub_id;
  IF p_result='expired' AND sub_id IS NOT NULL THEN UPDATE safewatch_private.family_push_subscriptions SET enabled=false WHERE id=sub_id; END IF;
END $$;
COMMIT;
