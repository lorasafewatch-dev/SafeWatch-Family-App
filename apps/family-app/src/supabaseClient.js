import { createClient } from '@supabase/supabase-js';
import { installRecoveryListener } from '../../shared/authFlow.js';

let client;
export function getFamilyClient() {
  if (!client) {
    client = createClient(import.meta.env.VITE_SUPABASE_URL || 'https://YOUR_PROJECT.supabase.co',
      import.meta.env.VITE_SUPABASE_ANON_KEY || 'YOUR_ANON_KEY');
    installRecoveryListener(client);
  }
  return client;
}
