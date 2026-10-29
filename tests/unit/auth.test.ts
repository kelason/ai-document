import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  headers: new Headers(),
  client: { auth: { getUser: vi.fn(), getSession: vi.fn(), signInWithPassword: vi.fn(), signUp: vi.fn(), signOut: vi.fn(), signInWithOAuth: vi.fn(), resend: vi.fn(), resetPasswordForEmail: vi.fn(), updateUser: vi.fn(), exchangeCodeForSession: vi.fn(), verifyOtp: vi.fn() }, rpc: vi.fn() },
}));
vi.mock('next/headers', () => ({
  headers: async () => state.headers,
  cookies: async () => ({ getAll: () => [...state.cookies].map(([name, value]) => ({ name, value })), get: (name: string) => state.cookies.has(name) ? { value: state.cookies.get(name) } : undefined, set: (name: string, value: string) => state.cookies.set(name, value), delete: (name: string) => state.cookies.delete(name) }),
}));
vi.mock('../../lib/supabase/server', () => ({ createServerSupabaseClient: async () => state.client }));
vi.mock('../../lib/security/rate-limit', () => ({ hashLimitKey: (scope: string, value: string) => `${scope}:${value}`, trustedClientIp: () => '127.0.0.1', requireLimit: async () => {} }));
import { safeReturnPath } from '../../lib/auth/return-path';
import { getSessionBinding, getVerifiedUser } from '../../lib/auth/context';
import { readSelectedMode, setSelectedMode } from '../../lib/auth/mode';
import { getAuthCsrfToken, signInWithPassword, signUp, requestPasswordReset, signOut, updatePassword, signInWithGoogle, resendVerification } from '../../app/auth/actions';
import { GET as confirm } from '../../app/auth/confirm/route';
import { GET as callback } from '../../app/auth/callback/route';

beforeEach(() => {
  vi.clearAllMocks(); state.cookies.clear();
  vi.stubEnv('APP_ORIGIN', 'https://docs.example.test'); vi.stubEnv('CSRF_SECRET', 'a'.repeat(64));
  state.headers = new Headers({ origin: 'https://docs.example.test' });
  state.client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
  state.client.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
  state.client.auth.signOut.mockResolvedValue({ error: null });
  state.client.rpc.mockResolvedValue({ data: true, error: null });
});
afterEach(() => vi.unstubAllEnvs());
const userId = '4e89a06b-2f64-4cb6-90f3-71594d503eda';
function authenticated(verified = true) {
  state.client.auth.getUser.mockResolvedValue({ data: { user: { id: userId, email_confirmed_at: verified ? '2026-10-27' : undefined } }, error: null });
  const payload = Buffer.from(JSON.stringify({ sub: userId, session_id: 'cab08246-06de-4432-8484-56f080050b1e' })).toString('base64url');
  state.client.auth.getSession.mockResolvedValue({ data: { session: { access_token: `header.${payload}.signature` } }, error: null });
}
async function csrf() { const result = await getAuthCsrfToken(); if (!result.ok) throw new Error(result.error); return result.csrfToken; }

describe('local return paths', () => {
  it.each([null, '', '//evil.test', 'https://evil.test', '/\\evil.test', '\\evil.test', '/%2fevil.test', '/%5cevil.test', '/%252fevil.test', '/\n/evil.test', ' /safe', '/%0devil', '/%zz'])('rejects external or ambiguous path %s', value => expect(safeReturnPath(value)).toBe('/'));
  it.each(['/docs/123?tab=history#v1', '/auth/reset-password', '/?q=hello%20world'])('preserves safe local destination %s', value => expect(safeReturnPath(value)).toBe(value));
});
describe('verified identity and explicit mode', () => {
  it('rejects forged or missing auth sessions', async () => { expect(await getVerifiedUser()).toBeNull(); expect(await getSessionBinding()).toBeNull(); });
  it('requires the current protected verification record as well as Auth confirmation', async () => {
    authenticated(false); expect(await getVerifiedUser()).toBeNull();
    authenticated(); state.client.rpc.mockResolvedValue({ data: false, error: null }); expect(await getVerifiedUser()).toBeNull();
  });
  it('accepts an existing verified session and binds CSRF to its validated session id', async () => {
    authenticated(); expect(await getVerifiedUser()).toEqual({ userId });
    expect(await getSessionBinding()).toBe(`auth:${userId}:cab08246-06de-4432-8484-56f080050b1e`);
  });
  it('fails closed on protected verification lookup failure', async () => {
    authenticated(); state.client.rpc.mockResolvedValue({ data: null, error: { message: 'secret' } });
    await expect(getVerifiedUser()).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
  it('rejects forged selected-mode cookies', async () => {
    await setSelectedMode('user'); expect(await readSelectedMode()).toBe('user');
    const name = [...state.cookies.keys()][0]; state.cookies.set(name, 'user.forged'); expect(await readSelectedMode()).toBeNull();
  });
});
describe('protected server actions', () => {
  it('rejects missing CSRF and cross-origin login without changing mode', async () => {
    expect(await signInWithPassword({ email: 'a@example.test', password: 'long-password!', csrfToken: 'forged' })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const token = await csrf(); state.headers.set('origin', 'https://evil.test');
    expect(await signInWithPassword({ email: 'a@example.test', password: 'long-password!', csrfToken: token })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    expect(await readSelectedMode()).toBeNull();
  });
  it('validates signup display names, unknown fields, and 12-character passwords', async () => {
    const token = await csrf();
    for (const input of [{ displayName: '', email: 'a@example.test', password: 'valid-password' }, { displayName: 'A', email: 'a@example.test', password: 'short' }, { displayName: 'A', email: 'a@example.test', password: 'valid-password', userId: 'spoof' }]) {
      expect(await signUp({ ...input, csrfToken: token })).toMatchObject({ ok: false, code: 'VALIDATION_ERROR' });
    }
  });
  it('returns uniform signup/reset responses without exposing provider/account errors', async () => {
    const token = await csrf();
    const input = { displayName: 'A', email: 'a@example.test', password: 'valid-password', csrfToken: token };
    state.client.auth.signUp.mockResolvedValue({ data: { session: null }, error: null }); const fresh = await signUp(input);
    state.client.auth.signUp.mockResolvedValue({ data: { session: null }, error: { message: 'already registered' } }); expect(await signUp(input)).toEqual(fresh);
    state.client.auth.resetPasswordForEmail.mockResolvedValue({ error: null }); const reset = await requestPasswordReset({ email: input.email, csrfToken: token });
    state.client.auth.resetPasswordForEmail.mockResolvedValue({ error: { message: 'unknown user' } }); expect(await requestPasswordReset({ email: input.email, csrfToken: token })).toEqual(reset);
  });
  it('rejects an unverified login and accepts a verified login while preserving guest credentials', async () => {
    state.client.auth.signInWithPassword.mockResolvedValue({ error: null });
    const token = await csrf(); authenticated(false);
    expect(await signInWithPassword({ email: 'a@example.test', password: 'valid-password', csrfToken: token })).toMatchObject({ ok: false, code: 'VERIFICATION_REQUIRED' });
    state.client.auth.getUser.mockResolvedValue({ data: { user: null }, error: null }); const freshToken = await csrf(); authenticated();
    state.cookies.set('guest-credential', 'retained-for-explicit-claim');
    expect(await signInWithPassword({ email: 'a@example.test', password: 'valid-password', csrfToken: freshToken, returnTo: '//evil.test' })).toEqual({ ok: true, redirectTo: '/' });
    expect(await readSelectedMode()).toBe('user'); expect(state.cookies.get('guest-credential')).toBe('retained-for-explicit-claim');
  });
  it('requires an authenticated session-bound token for password change and logs out locally', async () => {
    const preauth = await csrf(); authenticated();
    expect(await updatePassword({ password: 'new-valid-password', csrfToken: preauth })).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    const token = await csrf(); state.client.auth.updateUser.mockResolvedValue({ error: null });
    expect(await updatePassword({ password: 'new-valid-password', csrfToken: token })).toMatchObject({ ok: true });
    await setSelectedMode('user'); expect(await signOut({ csrfToken: token })).toMatchObject({ ok: true }); expect(await readSelectedMode()).toBeNull();
  });
  it('starts Google through a canonical callback without trusting return origins', async () => {
    const token = await csrf(); state.client.auth.signInWithOAuth.mockResolvedValue({ data: { url: 'https://accounts.google.com/o/oauth2/v2/auth' }, error: null });
    expect(await signInWithGoogle({ csrfToken: token, returnTo: '//evil.test' })).toEqual({ ok: true, redirectTo: 'https://accounts.google.com/o/oauth2/v2/auth' });
  });
});
describe('callback and confirmation routes', () => {
  const req = (path: string) => new Request(`https://attacker-controlled.invalid${path}`);
  it('redirects invalid, replayed, expired, or unsupported confirmations to a safe canonical error', async () => {
    state.client.auth.verifyOtp.mockResolvedValue({ error: { message: 'expired secret' } });
    for (const path of ['/auth/confirm', '/auth/confirm?token_hash=abc&type=signup&next=//evil.test', '/auth/confirm?token_hash=abc&type=invite']) {
      const response = await confirm(req(path)); expect(response.headers.get('location')).toBe('https://docs.example.test/auth?error=confirmation_invalid');
      expect(response.headers.get('cache-control')).toContain('no-store');
    }
  });
  it('accepts a confirmed account and a recovery link in a second tab without claiming guests', async () => {
    authenticated(); state.client.auth.verifyOtp.mockResolvedValue({ error: null }); state.cookies.set('guest-credential', 'untouched');
    const response = await confirm(req('/auth/confirm?token_hash=abc&type=recovery&next=//evil.test'));
    expect(response.headers.get('location')).toBe('https://docs.example.test/auth/reset-password'); expect(await readSelectedMode()).toBe('user'); expect(state.cookies.get('guest-credential')).toBe('untouched');
  });
  it('requires successful PKCE exchange and fresh verification before selecting user mode', async () => {
    state.client.auth.exchangeCodeForSession.mockResolvedValue({ error: { message: 'replayed' } });
    expect((await callback(req('/auth/callback?code=bad&next=//evil.test'))).headers.get('location')).toBe('https://docs.example.test/auth?error=callback_invalid');
    authenticated(); state.client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    expect((await callback(req('/auth/callback?code=valid&next=/docs/123'))).headers.get('location')).toBe('https://docs.example.test/docs/123');
  });
});

describe('existing-session auth transitions', () => {
  it('allows reauthentication using the currently validated auth-session token', async () => {
    authenticated(); const token = await csrf(); state.client.auth.signInWithPassword.mockResolvedValue({ error: null });
    expect(await signInWithPassword({ email: 'a@example.test', password: 'valid-password', csrfToken: token })).toMatchObject({ ok: true });
  });
  it('clears a stale user mode using a fresh preauth token after a session has been revoked', async () => {
    await setSelectedMode('user'); const token = await csrf();
    expect(await signOut({ csrfToken: token })).toMatchObject({ ok: true }); expect(await readSelectedMode()).toBeNull();
  });
});


describe('entry credentials after authentication', () => {
  it.each(['confirm', 'callback'])('invalidates the preauth credential after a successful %s', async route => {
    await csrf(); authenticated();
    state.client.auth.verifyOtp.mockResolvedValue({ error: null }); state.client.auth.exchangeCodeForSession.mockResolvedValue({ error: null });
    if (route === 'confirm') await confirm(new Request('https://docs.example.test/auth/confirm?token_hash=valid&type=email'));
    else await callback(new Request('https://docs.example.test/auth/callback?code=valid'));
    const value = [...state.cookies].find(([name]) => name.includes('preauth'))?.[1];
    expect(value).toBe('');
  });
  it('returns the same resend result for an existing and nonexistent account', async () => {
    const token = await csrf();
    state.client.auth.resend.mockResolvedValue({ error: null });
    const result = await resendVerification({ email: 'a@example.test', csrfToken: token });
    state.client.auth.resend.mockResolvedValue({ error: { message: 'private account state' } });
    expect(await resendVerification({ email: 'a@example.test', csrfToken: token })).toEqual(result);
  });
  it('rejects duplicate mode cookies without selecting a fallback', async () => {
    await setSelectedMode('guest'); const [name, value] = [...state.cookies][0];
    expect(await readSelectedMode(new Request('https://docs.example.test', { headers: { cookie: `${name}=${value}; ${name}=${value}` } }))).toBeNull();
  });
});

describe('local test inbox adapters', () => {
  it('reads confirmation links from the current Supabase Mailpit inbox', async () => {
    const { waitForAuthEmail } = await import('../helpers/auth');
    vi.stubGlobal('fetch', async (url: string) => {
      if (url.includes('/api/v1/search?')) return Response.json({ messages: [{ ID: 'message-1' }] });
      if (url.endsWith('/api/v1/message/message-1')) return Response.json({ HTML: '<a href="http://localhost:3000/auth/confirm?token_hash=hashed&amp;type=email">Confirm</a>', Text: '' });
      return new Response('not found', { status: 404 });
    });
    try { expect(await waitForAuthEmail('local@example.test', 100)).toEqual({ tokenHash: 'hashed', type: 'email',url:'http://localhost:3000/auth/confirm?token_hash=hashed&type=email' }); }
    finally { vi.unstubAllGlobals(); }
  });
});

it('preserves a same-origin email redirect destination and rejects external redirects',async()=>{
 authenticated();state.client.auth.verifyOtp.mockResolvedValue({error:null});
 const target=encodeURIComponent('https://docs.example.test/auth/callback?next=%2F%3Ffrom%3Demail');
 const response=await confirm(new Request(`https://docs.example.test/auth/confirm?token_hash=valid&type=email&redirect_to=${target}`));
 expect(response.headers.get('location')).toBe('https://docs.example.test/?from=email');
 const external=await confirm(new Request('https://docs.example.test/auth/confirm?token_hash=valid&type=email&redirect_to=https%3A%2F%2Fevil.test%2Fauth%2Fcallback%3Fnext%3D%2Fsecret'));
 expect(external.headers.get('location')).toBe('https://docs.example.test/');
});
