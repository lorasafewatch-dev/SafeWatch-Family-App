import { generateRequestDetails } from 'npm:web-push@4.0.0';
import { createPushHandler } from '../_shared/pushDelivery.js';

const url = Deno.env.get('SUPABASE_URL')!;
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') || '{}');
const secret = secretKeys.default || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const rpc = async (name: string, args: Record<string, unknown>) => {
  const response = await fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: secret,
      ...(secret.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${secret}` }) },
    body: JSON.stringify(args), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error('Push RPC failed'); }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
};

// Authentication is performed by the service-only claim RPC using a dedicated
// random Vault token. A public caller cannot supply a recipient or an alert.
Deno.serve(createPushHandler({ rpc, createRequest: generateRequestDetails }));
