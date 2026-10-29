import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { applicationOrigin } from './lib/security/csrf';
import { supabasePublicConfig } from './lib/supabase/server';
import {securityHeaders} from './lib/security/headers';
import { toErrorResponse } from './lib/http/errors';

/** Refresh transport only; every data entrypoint verifies identity and authorization again. */
export async function proxy(request: NextRequest) {
  try {
    const { url, key } = supabasePublicConfig();
    const security=securityHeaders();
    const requestHeaders=new Headers(request.headers);
    requestHeaders.set('x-nonce',security.nonce);
    requestHeaders.set('Content-Security-Policy',security.csp);
    let response = NextResponse.next({ request:{headers:requestHeaders} });
    const client = createServerClient(url, key, {
      cookieOptions: { path: '/', sameSite: 'lax', httpOnly:true, secure: applicationOrigin().startsWith('https:') },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values) {
          for (const { name, value } of values) request.cookies.set(name, value);
          requestHeaders.set('cookie',request.cookies.toString());
          response = NextResponse.next({ request:{headers:requestHeaders} });
          for (const { name, value, options } of values) response.cookies.set(name, value, options);
        },
      },
    });
    // Do not authorize from cookies/getSession or cache a user-dependent response.
    await client.auth.getUser();
    for(const [name,value] of Object.entries(security.headers))response.headers.set(name,value);
    response.headers.append('Vary', 'Cookie');
    return response;
  } catch (error) {
    const response = toErrorResponse(error);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
}
export const config = { matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'] };
