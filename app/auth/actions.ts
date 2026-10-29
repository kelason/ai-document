'use server';

import { z } from 'zod';
import { cookies, headers } from 'next/headers';
import { createServerSupabaseClient } from '../../lib/supabase/server';
import { verifiedUserFromClient, sessionBindingFromClient } from '../../lib/auth/context';
import { clearSelectedMode, setSelectedMode } from '../../lib/auth/mode';
import { safeReturnPath } from '../../lib/auth/return-path';
import { ApiError, type ErrorCode } from '../../lib/http/errors';
import { applicationOrigin, createPreAuthSession, getPreAuthBinding, issueCsrf, preAuthCookieName, requireCsrf, requireSameOrigin, verifyCsrf } from '../../lib/security/csrf';
import { hashLimitKey, requireLimit, trustedClientIp } from '../../lib/security/rate-limit';

export type AuthActionResult =
  | { ok: true; redirectTo?: string; message?: string }
  | { ok: false; code: ErrorCode; error: string; retryAfter?: number };
export type AuthActionInput = { csrfToken: string; returnTo?: string };
export type PasswordSignInInput = AuthActionInput & { email: string; password: string };
export type SignUpInput = PasswordSignInInput & { displayName: string };
export type EmailActionInput = AuthActionInput & { email: string };
export type PasswordUpdateInput = AuthActionInput & { password: string };

const base = z.object({ csrfToken: z.string().max(200), returnTo: z.string().max(2048).optional() });
const email = z.string().trim().email().max(254).transform(value => value.toLowerCase());
const password = z.string().min(12).max(128);
const loginSchema = base.extend({ email, password: z.string().min(1).max(128) }).strict();
const signupSchema = base.extend({ email, password, displayName: z.string().trim().min(1).max(100).refine(value => !/[\u0000-\u001f\u007f]/.test(value)) }).strict();
const emailSchema = base.extend({ email }).strict();
const updateSchema = base.extend({ password }).strict();
const genericEmailMessage = 'If the account can receive this email, check your inbox for the next step.';

function safeError(error: unknown): Extract<AuthActionResult, { ok: false }> {
  const known = error instanceof ApiError ? error : new ApiError('STORAGE_UNAVAILABLE', 'Authentication is temporarily unavailable.');
  return { ok: false, code: known.code, error: known.message, ...(known.options.retryAfterSeconds ? { retryAfter: known.options.retryAfterSeconds } : {}) };
}
async function requestContext(): Promise<Request> {
  const requestHeaders = new Headers(await headers());
  requestHeaders.set('cookie', (await cookies()).getAll().map(({ name, value }) => `${name}=${value}`).join('; '));
  return new Request(applicationOrigin(), { method: 'POST', headers: requestHeaders });
}
async function limit(request: Request, account?: string) {
  await requireLimit(hashLimitKey('auth-ip', trustedClientIp(request)), 'auth');
  if (account) await requireLimit(hashLimitKey('auth-email', account), 'auth');
}
async function prepare<T extends AuthActionInput>(schema: z.ZodType<T>, input: unknown, authenticated = false) {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR', 'Check your account details and try again.');
  const request = await requestContext();
  const client = await createServerSupabaseClient({ writable: true });
  requireSameOrigin(request);
  const sessionBinding = await sessionBindingFromClient(client);
  const binding = authenticated
    ? sessionBinding
    : sessionBinding && verifyCsrf(sessionBinding, parsed.data.csrfToken) ? sessionBinding : getPreAuthBinding(request);
  if (!binding) throw new ApiError('UNAUTHENTICATED', 'Sign in to continue.');
  const withToken = new Request(request, { headers: new Headers(request.headers) });
  withToken.headers.set('x-csrf-token', parsed.data.csrfToken);
  requireCsrf(withToken, binding);
  await limit(request, 'email' in parsed.data ? String(parsed.data.email) : undefined);
  return { input: parsed.data, client };
}
function callbackUrl(returnTo?: string): string {
  const url = new URL('/auth/callback', applicationOrigin());
  url.searchParams.set('next', safeReturnPath(returnTo ?? null));
  return url.toString();
}
async function selectUser() {
  await setSelectedMode('user');
  (await cookies()).set(preAuthCookieName(), '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'strict', secure: applicationOrigin().startsWith('https:') });
}

/** Call from the same-origin client before forms; token is bound to auth session or signed preauth cookie. */
export async function getAuthCsrfToken(): Promise<{ ok: true; csrfToken: string } | Extract<AuthActionResult, { ok: false }>> {
  try {
    const request = await requestContext(); requireSameOrigin(request); await limit(request);
    const binding = await sessionBindingFromClient(await createServerSupabaseClient({ writable: true }));
    if (binding) return { ok: true, csrfToken: issueCsrf(binding) };
    const bootstrap = createPreAuthSession();
    const cookie = bootstrap.response.headers.get('set-cookie')!.split(';')[0];
    const value = cookie.slice(cookie.indexOf('=') + 1);
    (await cookies()).set(preAuthCookieName(), value, { path: '/', maxAge: 15 * 60, httpOnly: true, sameSite: 'strict', secure: applicationOrigin().startsWith('https:') });
    return { ok: true, csrfToken: issueCsrf(bootstrap.binding) };
  } catch (error) { return safeError(error); }
}
export async function signInWithGoogle(input: AuthActionInput): Promise<AuthActionResult> {
  try {
    const prepared = await prepare(base.strict(), input);
    const result = await prepared.client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(prepared.input.returnTo), skipBrowserRedirect: true } });
    if (result.error || !result.data.url) throw new ApiError('STORAGE_UNAVAILABLE', 'Google sign-in is temporarily unavailable.');
    return { ok: true, redirectTo: result.data.url };
  } catch (error) { return safeError(error); }
}
export async function signInWithPassword(input: PasswordSignInInput): Promise<AuthActionResult> {
  try {
    const prepared = await prepare(loginSchema, input);
    const result = await prepared.client.auth.signInWithPassword({ email: prepared.input.email, password: prepared.input.password });
    if (result.error) throw new ApiError('UNAUTHENTICATED', 'Unable to sign in with those details. Verify your email if needed.');
    if (!await verifiedUserFromClient(prepared.client)) {
      await prepared.client.auth.signOut({ scope: 'local' });
      throw new ApiError('VERIFICATION_REQUIRED', 'Verify your email before accessing your account.');
    }
    await selectUser();
    return { ok: true, redirectTo: safeReturnPath(prepared.input.returnTo ?? null) };
  } catch (error) { return safeError(error); }
}
export async function signUp(input: SignUpInput): Promise<AuthActionResult> {
  try {
    const prepared = await prepare(signupSchema, input);
    const result = await prepared.client.auth.signUp({ email: prepared.input.email, password: prepared.input.password, options: { data: { display_name: prepared.input.displayName }, emailRedirectTo: callbackUrl(prepared.input.returnTo) } });
    // Signup never adopts an inferred account or claims guest data, including duplicate-email responses.
    if (result.data?.session) await prepared.client.auth.signOut({ scope: 'local' });
    return { ok: true, message: genericEmailMessage };
  } catch (error) { return safeError(error); }
}
export async function resendVerification(input: EmailActionInput): Promise<AuthActionResult> {
  try {
    const prepared = await prepare(emailSchema, input);
    await prepared.client.auth.resend({ type: 'signup', email: prepared.input.email, options: { emailRedirectTo: callbackUrl(prepared.input.returnTo) } });
    return { ok: true, message: genericEmailMessage };
  } catch (error) { return safeError(error); }
}
export async function requestPasswordReset(input: EmailActionInput): Promise<AuthActionResult> {
  try {
    const prepared = await prepare(emailSchema, input);
    await prepared.client.auth.resetPasswordForEmail(prepared.input.email, { redirectTo: callbackUrl('/auth/reset-password') });
    return { ok: true, message: genericEmailMessage };
  } catch (error) { return safeError(error); }
}
export async function updatePassword(input: PasswordUpdateInput): Promise<AuthActionResult> {
  try {
    const prepared = await prepare(updateSchema, input, true);
    if (!await verifiedUserFromClient(prepared.client)) throw new ApiError('VERIFICATION_REQUIRED', 'Verify your email before changing your password.');
    const result = await prepared.client.auth.updateUser({ password: prepared.input.password });
    if (result.error) throw new ApiError('VALIDATION_ERROR', 'Unable to change your password. Open a fresh recovery email or sign in again.');
    return { ok: true, message: 'Your password has been changed.' };
  } catch (error) { return safeError(error); }
}
export async function signOut(input: AuthActionInput): Promise<AuthActionResult> {
  try {
    const prepared = await prepare(base.strict(), input);
    const result = await prepared.client.auth.signOut({ scope: 'local' });
    if (result.error) throw new ApiError('STORAGE_UNAVAILABLE', 'Unable to sign out. Please try again.');
    await clearSelectedMode();
    return { ok: true, redirectTo: '/auth' };
  } catch (error) { return safeError(error); }
}
