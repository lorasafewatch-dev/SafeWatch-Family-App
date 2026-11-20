# Family SOS background notifications

The installed Family PWA receives encrypted Web Push even when its page is closed. Android controls notification sound, vibration, permission, battery restrictions and Do Not Disturb. A PWA cannot promise a continuous alarm, bypass silent mode, or deliver while the device is offline or Chrome has been force-stopped.

Enable **SOS notifications** from Home or Profile on each device. Profile includes a test notification, delayed 15 seconds so the app can be closed before delivery, and a device-specific off switch. Tests do not create SOS incidents or contact barangay staff.

The service worker displays a generic lock-screen message with no senior name, photo, medical reading or GPS coordinates. Tapping it opens `/?sos=<alert ID>` in SafeWatch. The app authenticates the viewer, loads that exact incident under existing RLS, selects its Watch ID and opens either its pending response popup or its saved details. Opening a notification never acknowledges or transfers an SOS.

The alert insertion writes a private outbox entry for each approved linked family's subscribed device. The five-second database dispatcher invokes the `family-sos-push` Edge Function. The sender rechecks active sessions, account approval, consent, MFA, watch linkage and incident status before delivery. Sign-out, revocation and completion prevent queued delivery. Repeated watch packets do not create additional notifications; delivery IDs, leases, notification tags and persistent worker receipts suppress retries. Expired endpoints are disabled and delivery records are retained for three days. The existing three-minute unanswered SOS transfer is independent of push delivery.

When barangay confirms an SOS, subscribed family devices receive **Barangay personnel are on the way**. When staff selects **Mark as arrived**, those devices receive **Barangay personnel have arrived**. Tapping either notification opens the current saved response for that incident. Apply `supabase/migrations/20261120044500_family_barangay_response_push.sql` and `supabase/migrations/20261120045500_barangay_sos_arrival.sql` in order, then deploy the updated barangay dashboard and Family PWA. The existing Edge Function and push configuration handle both alerts.

Deployment requires the migration, the Edge Function and these two encrypted Supabase Vault secrets, generated once and kept out of source control:

- `safewatch_family_push_dispatch`: a random 32-byte hexadecimal dispatcher token.
- `safewatch_family_push_vapid`: JSON containing `publicKey`, `privateKey` and a valid HTTPS `subject`, using the Web Push P-256 VAPID format.

Set the private singleton `family_push_config.public_key` to the corresponding public key and `function_url` to the project's `/functions/v1/family-sos-push` URL. Only the public key is returned by the family configuration RPC. The function uses its platform-provided server key, and only service-role callers can claim or finish deliveries. The function's gateway JWT check is disabled because its request is authenticated using the dedicated dispatcher token; it accepts no caller-provided recipients or payloads.

Verification: `node apps/family-app/tests/background-push.test.mjs`, `node supabase/tests/family_sos_background_push.test.mjs`, `node scripts/verify_background_sos_push.mjs`, and the existing family-first SOS browser regression. Run the browser scripts against isolated fixtures, then use **Send test notification** for an actual closed-app device check.
