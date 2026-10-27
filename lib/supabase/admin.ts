import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { ApiError } from '../http/errors';

/** Restricted server-only jobs/RPCs. Never use for persistent user document queries. */
export function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new ApiError('STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}
