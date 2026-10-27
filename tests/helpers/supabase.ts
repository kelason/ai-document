import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Destructive test fixtures are permitted only on the local Supabase stack. */
export function integrationClients() {
  const url = process.env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321';
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) {
    throw new Error('Integration authorization tests require a local Supabase URL.');
  }
  const anonKey = process.env.SUPABASE_TEST_ANON_KEY;
  const serviceKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY;
  if (!anonKey || !serviceKey) {
    throw new Error('Start local Supabase and set SUPABASE_TEST_ANON_KEY and SUPABASE_TEST_SERVICE_ROLE_KEY. Database tests are never skipped.');
  }
  const options = { auth: { autoRefreshToken: false, persistSession: false } };
  return {
    admin: createClient(url, serviceKey, options),
    anon: createClient(url, anonKey, options),
    user: (token: string) => createClient(url, anonKey, {
      ...options, global: { headers: { Authorization: `Bearer ${token}` } },
    }),
    signIn: () => createClient(url, anonKey, options),
  };
}

export async function seedVerifiedUser(
  admin: SupabaseClient,
  signIn: SupabaseClient,
  label: string,
) {
  const email = `${label}-${crypto.randomUUID()}@example.test`;
  const password = `Test-${crypto.randomUUID()}-!1a`;
  const created = await admin.auth.admin.createUser({
    email, password, email_confirm: true, user_metadata: { display_name: label },
  });
  if (created.error || !created.data.user) throw created.error ?? new Error('Missing test user');
  const session = await signIn.auth.signInWithPassword({ email, password });
  if (session.error || !session.data.session) throw session.error ?? new Error('Missing test session');
  return { id: created.data.user.id, email, token: session.data.session.access_token };
}
