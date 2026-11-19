BEGIN;

-- Accept subscriptions from the supported browser push services. Keep endpoint
-- ownership on upsert and allow each family to enable all of their devices.
CREATE OR REPLACE FUNCTION safewatch_private.save_family_push_subscription(p_subscription JSONB,p_expected_user_id UUID)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public
AS $$ DECLARE current_user_id UUID:=auth.uid(); current_session UUID; saved_id UUID; BEGIN
  IF current_user_id IS NULL OR p_expected_user_id IS DISTINCT FROM current_user_id OR NOT public.safewatch_has_app_access('family') THEN
    RAISE EXCEPTION 'Approved family access is required' USING ERRCODE='42501'; END IF;
  current_session:=NULLIF(auth.jwt()->>'session_id','')::uuid;
  IF NOT safewatch_private.family_push_allowed(current_user_id,current_session) THEN RAISE EXCEPTION 'Sign in again to enable notifications' USING ERRCODE='42501'; END IF;
  IF p_subscription IS NULL OR jsonb_typeof(p_subscription)<>'object'
    OR length(COALESCE(p_subscription->>'endpoint',''))>2048
    OR COALESCE(p_subscription->>'endpoint','') !~ '^https://(fcm[.]googleapis[.]com|updates[.]push[.]services[.]mozilla[.]com|([a-z0-9-]+[.])+push[.]apple[.]com|([a-z0-9-]+[.])+notify[.]windows[.]com)/[A-Za-z0-9_./=:%?&+~-]+$'
    OR COALESCE(p_subscription->'keys'->>'p256dh','') !~ '^[A-Za-z0-9_-]{87}$'
    OR COALESCE(p_subscription->'keys'->>'auth','') !~ '^[A-Za-z0-9_-]{22}$' THEN
    RAISE EXCEPTION 'Invalid push subscription' USING ERRCODE='22023'; END IF;
  INSERT INTO safewatch_private.family_push_subscriptions(user_id,session_id,endpoint,p256dh,auth_key)
    VALUES(current_user_id,current_session,p_subscription->>'endpoint',p_subscription->'keys'->>'p256dh',p_subscription->'keys'->>'auth')
    ON CONFLICT(endpoint) DO UPDATE SET session_id=EXCLUDED.session_id,p256dh=EXCLUDED.p256dh,auth_key=EXCLUDED.auth_key,enabled=true,updated_at=clock_timestamp()
      WHERE family_push_subscriptions.user_id=current_user_id
    RETURNING id INTO saved_id;
  IF saved_id IS NULL THEN RAISE EXCEPTION 'Turn off notifications for the previous account before enabling them' USING ERRCODE='42501'; END IF;
  RETURN saved_id;
END $$;
COMMIT;
