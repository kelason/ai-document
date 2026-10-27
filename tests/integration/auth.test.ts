import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { authHarness, waitForAuthEmail } from '../helpers/auth';
import { verifiedUserFromClient, sessionBindingFromClient } from '../../lib/auth/context';

// Uses the real local Auth server, PostgREST verification RPC and Inbucket.
// Missing Docker/local credentials is an explicit failure, never a skipped security test.
describe('verified Auth lifecycle against the local stack', () => {
  let harness: ReturnType<typeof authHarness>;
  const ids: string[] = [];
  beforeAll(() => { harness = authHarness(); });
  afterAll(async () => {
    if (!harness) return;
    for (const id of ids) {
      const result = await harness.admin.auth.admin.deleteUser(id);
      if (result.error && !result.error.message.includes('not found')) throw result.error;
    }
  });

  it('confirms signup once via the test inbox, rejects replay, signs out and rejects a forged cookie', async () => {
    const email = `signup-${crypto.randomUUID()}@example.test`;
    const password = `Auth-test-${crypto.randomUUID()}`;
    const client = harness.newTab();
    const signup = await client.auth.signUp({ email, password, options: { data: { display_name: 'Auth integration' } } });
    expect(signup.error).toBeNull(); expect(signup.data.session).toBeNull();
    if (signup.data.user) ids.push(signup.data.user.id);
    expect((await client.auth.signInWithPassword({ email, password })).error).not.toBeNull();
    expect(await verifiedUserFromClient(client)).toBeNull();
    const emailLink = await waitForAuthEmail(email);
    const verified = await client.auth.verifyOtp({ token_hash: emailLink.tokenHash, type: emailLink.type });
    expect(verified.error).toBeNull();
    expect(await verifiedUserFromClient(client)).toEqual({ userId: signup.data.user!.id });
    expect(await sessionBindingFromClient(client)).toMatch(/^auth:[0-9a-f-]+:[0-9a-f-]+$/);
    expect((await harness.newTab(new Map()).auth.verifyOtp({ token_hash: emailLink.tokenHash, type: emailLink.type })).error).not.toBeNull();
    expect((await client.auth.signOut({ scope: 'local' })).error).toBeNull();
    expect(await verifiedUserFromClient(harness.newTab())).toBeNull();
    const forged = new Map([[`sb-${new URL(process.env.SUPABASE_TEST_URL ?? 'http://127.0.0.1:54321').hostname.split('.')[0]}-auth-token`, 'base64-' + Buffer.from(JSON.stringify({ access_token: 'forged.jwt.signature', refresh_token: 'forged' })).toString('base64url')]]);
    expect(await verifiedUserFromClient(harness.newTab(forged))).toBeNull();
  }, 25_000);

  it('accepts an existing session but revokes the same JWT when current profile verification changes', async () => {
    const email = `revoked-${crypto.randomUUID()}@example.test`;
    const password = `Auth-test-${crypto.randomUUID()}`;
    const user = await harness.admin.auth.admin.createUser({ email, password, email_confirm: true });
    expect(user.error).toBeNull(); ids.push(user.data.user!.id);
    const client = harness.newTab(); expect((await client.auth.signInWithPassword({ email, password })).error).toBeNull();
    expect(await verifiedUserFromClient(harness.newTab())).toEqual({ userId: user.data.user!.id });
    const staleToken = (await client.auth.getSession()).data.session!.access_token;
    expect((await harness.admin.from('profiles').update({ verified: false }).eq('id', user.data.user!.id)).error).toBeNull();
    expect(await verifiedUserFromClient(client)).toBeNull();
    expect((await harness.user(staleToken).rpc('is_verified_user')).data).toBe(false);
  });

  it('recovers a password in a new tab with no PKCE storage and rejects a spent recovery link', async () => {
    const email = `recovery-${crypto.randomUUID()}@example.test`;
    const oldPassword = `Auth-test-${crypto.randomUUID()}`;
    const newPassword = `Updated-${crypto.randomUUID()}`;
    const user = await harness.admin.auth.admin.createUser({ email, password: oldPassword, email_confirm: true });
    expect(user.error).toBeNull(); ids.push(user.data.user!.id);
    const firstTab = harness.newTab(new Map());
    expect((await firstTab.auth.resetPasswordForEmail(email)).error).toBeNull();
    const emailLink = await waitForAuthEmail(email);
    const secondTab = harness.newTab(new Map());
    expect((await secondTab.auth.verifyOtp({ token_hash: emailLink.tokenHash, type: 'recovery' })).error).toBeNull();
    expect(await verifiedUserFromClient(secondTab)).toEqual({ userId: user.data.user!.id });
    expect((await secondTab.auth.updateUser({ password: newPassword })).error).toBeNull();
    expect((await harness.signIn().auth.signInWithPassword({ email, password: oldPassword })).error).not.toBeNull();
    expect((await harness.signIn().auth.signInWithPassword({ email, password: newPassword })).error).toBeNull();
    expect((await harness.newTab(new Map()).auth.verifyOtp({ token_hash: emailLink.tokenHash, type: 'recovery' })).error).not.toBeNull();
  }, 25_000);
});
