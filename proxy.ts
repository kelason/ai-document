import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { applicationOrigin } from './lib/security/csrf';
import { supabasePublicConfig } from './lib/supabase/server';
import { toErrorResponse } from './lib/http/errors';

/** Refresh transport only; every data entrypoint verifies identity and authorization again. */
export async function proxy(request: NextRequest) {
  try {
    const { url, key } = supabasePublicConfig();
    let response = NextResponse.next({ request });
    const client = createServerClient(url, key, {
      cookieOptions: { path: '/', sameSite: 'lax', secure: applicationOrigin().startsWith('https:') },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          for (const { name, value } of values) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of values) response.cookies.set(name, value, options);
        },
      },
    });
    // Do not authorize from cookies/getSession or cache a user-dependent response.
    await client.auth.getUser();
    response.headers.set('Cache-Control', 'private, no-store');
    response.headers.append('Vary', 'Cookie');
    return response;
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] };
