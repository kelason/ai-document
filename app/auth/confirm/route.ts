import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { verifiedUserFromClient } from '../../../lib/auth/context';
import { setSelectedMode } from '../../../lib/auth/mode';
import { safeReturnPath } from '../../../lib/auth/return-path';
import { applicationOrigin, preAuthCookieName } from '../../../lib/security/csrf';
import { hashLimitKey, requireLimit, trustedClientIp } from '../../../lib/security/rate-limit';
import { toErrorResponse } from '../../../lib/http/errors';

/** Email templates use token_hash links, allowing recovery in a second tab/browser without PKCE storage. */
export async function GET(request: Request) {
  try {
    await requireLimit(hashLimitKey('auth-ip', trustedClientIp(request)), 'auth');
    const url = new URL(request.url);
    const tokenHash = url.searchParams.get('token_hash');
    const type = url.searchParams.get('type');
    if (!tokenHash || tokenHash.length > 4096 || !['signup', 'recovery', 'email_change', 'email'].includes(type ?? '')) return redirect('/auth?error=confirmation_invalid');
    const client = await createServerSupabaseClient({ writable: true });
    const result = await client.auth.verifyOtp({ token_hash: tokenHash, type: type! });
    if (result.error) return redirect('/auth?error=confirmation_invalid');
    if (!await verifiedUserFromClient(client)) {
      await client.auth.signOut({ scope: 'local' });
      return redirect('/auth?error=verification_required');
    }
    await setSelectedMode('user');
    (await cookies()).set(preAuthCookieName(), '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'strict', secure: applicationOrigin().startsWith('https:') });
    return redirect(type === 'recovery' ? '/auth/reset-password' : safeReturnPath(url.searchParams.get('next')));
  } catch (error) { const response = toErrorResponse(error); response.headers.set('Cache-Control', 'no-store'); return response; }
}
function redirect(path: string) {
  const response = NextResponse.redirect(new URL(path, applicationOrigin()), 303);
  response.headers.set('Cache-Control', 'private, no-store'); response.headers.set('Referrer-Policy', 'no-referrer'); response.headers.set('Vary', 'Cookie');
  return response;
}
