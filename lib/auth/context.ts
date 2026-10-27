import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '../supabase/server';
import { ApiError } from '../http/errors';

/** Auth performs network verification; current protected DB state can revoke old JWTs. */
export async function verifiedUserFromClient(client: SupabaseClient): Promise<{ userId: string } | null> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || !user.email_confirmed_at) return null;
  const result = await client.rpc('is_verified_user');
  if (result.error) throw new ApiError('STORAGE_UNAVAILABLE', 'Authentication is temporarily unavailable.');
  return result.data === true ? { userId: user.id } : null;
}
export async function getVerifiedUser(): Promise<{ userId: string } | null> {
  return verifiedUserFromClient(await createServerSupabaseClient());
}

/** Use session data only AFTER getUser validates it. Session IDs separate concurrent logins. */
export async function sessionBindingFromClient(client: SupabaseClient): Promise<string | null> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session) return null;
  try {
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.sub !== user.id || typeof claims.session_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.session_id)) return null;
    return `auth:${user.id}:${claims.session_id}`;
  } catch { return null; }
}
export async function getSessionBinding(): Promise<string | null> {
  return sessionBindingFromClient(await createServerSupabaseClient());
}
