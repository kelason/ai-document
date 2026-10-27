import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ApiError } from '../http/errors';
import { applicationOrigin } from '../security/csrf';

export function supabasePublicConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new ApiError('STORAGE_UNAVAILABLE', 'Authentication is temporarily unavailable.');
  return { url, key };
}

/** One client per request. Proxy refreshes read-only Server Component cookies. */
export async function createServerSupabaseClient(options: { writable?: boolean } = {}) {
  const jar = await cookies();
  const { url, key } = supabasePublicConfig();
  return createServerClient(url, key, {
    cookieOptions: { path: '/', sameSite: 'lax', secure: applicationOrigin().startsWith('https:') },
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        if (options.writable) {
          for (const { name, value, options: settings } of values) jar.set(name, value, settings);
        }
        // Server Components cannot write cookies; proxy must propagate refreshes.
      },
    },
  });
}
