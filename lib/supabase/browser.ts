'use client';
import { createBrowserClient } from '@supabase/ssr';

/** Browser session state is for UX; server getUser + current database policy authorize access. */
export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Authentication is temporarily unavailable.');
  return createBrowserClient(url, key, {
    auth: { detectSessionInUrl: false },
    cookieOptions: { path: '/', sameSite: 'lax', secure: typeof window !== 'undefined' && window.location.protocol === 'https:' },
  });
}
