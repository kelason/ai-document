import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createRecipientResolver } from '../../lib/sharing/recipients';

// Only the framework's server-boundary marker is replaced in this Node runner.
vi.mock('server-only', () => ({}));

import { integrationClients, seedVerifiedUser } from '../helpers/supabase';

// Every request is sent to real PostgREST with a user JWT, including stale JWTs.
// Removing a policy/helper check must expose rows or make an allowed request fail.
describe('persistent authorization through REST and RPC', () => {
  let clients: ReturnType<typeof integrationClients>;
  const users: Array<{ id: string; email: string; token: string; client: SupabaseClient }> = [];
  let documentId: string;
  let otherDocumentId: string;
  let shareId: string;
  const document = () => ({ p_document_id: documentId });

  beforeAll(async () => {
    clients = integrationClients();
    const health = await clients.admin.from('profiles').select('id').limit(1);
    if (health.error) throw new Error(`Local database is unavailable or unmigrated: ${health.error.message}`);
    for (const label of ['owner', 'editor', 'viewer', 'unrelated', 'revoked']) {
      const user = await seedVerifiedUser(clients.admin, clients.signIn(), label);
      users.push({ ...user, client: clients.user(user.token) });
    }
    const created = await users[0].client.rpc('create_document', { p_title: 'Protected', p_content: '<p>original</p>' }).single<{ id: string }>();
    expect(created.error).toBeNull();
    documentId = created.data!.id;
    const other = await users[3].client.rpc('create_document', { p_title: 'Other', p_content: '' }).single<{ id: string }>();
    expect(other.error).toBeNull();
    otherDocumentId = other.data!.id;
    for (const [index, permission] of [[1, 'edit'], [2, 'view'], [4, 'edit']] as const) {
      const grant = await users[0].client.rpc('grant_document_share', { ...document(), p_user_id: users[index].id, p_permission: permission }).single<{ id: string }>();
      expect(grant.error).toBeNull();
      if (index === 4) shareId = grant.data!.id;
    }
  }, 60_000);

  afterAll(async () => {
    for (const user of users) {
      const deleted = await clients.admin.auth.admin.deleteUser(user.id);
      if (deleted.error && !deleted.error.message.includes('not found')) throw deleted.error;
    }
  });

  it('permits owner/editor/viewer reads but hides every child table from unrelated users', async () => {
    for (const index of [0, 1, 2]) {
      const read = await users[index].client.from('documents').select('id').eq('id', documentId);
      expect(read.error).toBeNull();
      expect(read.data).toHaveLength(1);
    }
    for (const table of ['documents', 'document_history', 'document_shares', 'document_attachments', 'document_presence']) {
      const query = users[3].client.from(table).select('*').eq(table === 'documents' ? 'id' : 'document_id', documentId);
      const read = await query;
      expect(read.error).toBeNull();
      expect(read.data).toEqual([]);
    }
    expect((await clients.anon.from('documents').select('id')).error).not.toBeNull();
  });

  it('allows an editor to atomically save history and denies viewer mutations and ownership changes', async () => {
    expect((await users[1].client.rpc('update_document', { ...document(), p_content: '<p>edited</p>' })).error).toBeNull();
    const history = await users[0].client.from('document_history').select('*').eq('document_id', documentId);
    expect(history.error).toBeNull();
    expect(history.data?.some((row) => row.content === '<p>edited</p>' && row.updated_by === users[1].id)).toBe(true);
    expect((await users[2].client.rpc('update_document', { ...document(), p_title: 'bad' })).error?.code).toBe('42501');
    expect((await users[0].client.from('documents').update({ owner_id: users[3].id }).eq('id', documentId)).error?.code).toBe('42501');
    expect((await users[1].client.from('document_history').insert({ document_id: documentId, title: 'fake', content: '', updated_by: users[0].id })).error?.code).toBe('42501');
    expect((await users[2].client.from('documents').delete().eq('id', documentId).select()).data).toEqual([]);
    const foreignVersion = await users[3].client.from('document_history').select('id').eq('document_id', otherDocumentId).single();
    expect(foreignVersion.error).toBeNull();
    expect((await users[0].client.rpc('restore_document', { ...document(), p_version_id: foreignVersion.data!.id })).error?.code).toBe('42501');
  });

  it('requires document ownership for exact-email resolution and sharing', async () => {
    const resolveRecipient = createRecipientResolver(users[0].client, documentId);
    await expect(resolveRecipient(` ${users[2].email.toUpperCase()} `)).resolves.toEqual({ userId: users[2].id });
    await expect(resolveRecipient('not an email')).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(resolveRecipient('missing@example.test')).resolves.toBeNull();
    await expect(createRecipientResolver(users[2].client, documentId)(users[3].email)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const resolved = await users[0].client.rpc('resolve_share_recipient', { ...document(), p_email: users[2].email.toUpperCase() });
    expect(resolved.error).toBeNull();
    expect(resolved.data).toBe(users[2].id);
    expect((await users[0].client.rpc('resolve_share_recipient', { ...document(), p_email: '%@example.test' })).data).toBeNull();
    expect((await users[2].client.rpc('resolve_share_recipient', { ...document(), p_email: users[3].email })).error?.code).toBe('42501');
    expect((await users[1].client.rpc('grant_document_share', { ...document(), p_user_id: users[3].id, p_permission: 'edit' })).error?.code).toBe('42501');
    expect((await users[0].client.from('document_shares').insert({ document_id: documentId, user_id: users[3].id, permission: 'edit' })).error?.code).toBe('42501');
    expect((await users[0].client.from('profiles').select('email')).error?.code).toBe('42501');
  });

  it('binds attachment and presence identity, document references, and edit permission', async () => {
    const attachment = { document_id: documentId, uploaded_by: users[1].id, filename: 'ok.txt', mime_type: 'text/plain', size_bytes: 1, url: '/attachment-placeholder' };
    expect((await users[1].client.from('document_attachments').insert(attachment)).error).toBeNull();
    expect((await users[2].client.from('document_attachments').insert({ ...attachment, uploaded_by: users[2].id })).error?.code).toBe('42501');
    expect((await users[1].client.from('document_attachments').insert({ ...attachment, uploaded_by: users[0].id })).error?.code).toBe('42501');
    expect((await users[2].client.from('document_presence').insert({ document_id: documentId, user_id: users[2].id, active: true })).error).toBeNull();
    expect((await users[2].client.from('document_presence').insert({ document_id: otherDocumentId, user_id: users[2].id, active: true })).error?.code).toBe('42501');
    expect((await users[2].client.from('document_presence').update({ user_id: users[0].id }).eq('document_id', documentId)).error?.code).toBe('42501');
  });

  it('revokes access on the next REST and RPC request with the same JWT', async () => {
    expect((await users[4].client.from('documents').select('id').eq('id', documentId)).data).toHaveLength(1);
    expect((await users[0].client.from('document_shares').delete().eq('id', shareId)).error).toBeNull();
    expect((await users[4].client.from('documents').select('id').eq('id', documentId)).data).toEqual([]);
    expect((await users[4].client.rpc('update_document', { ...document(), p_title: 'stale' })).error?.code).toBe('42501');
  });

  it('denies stale JWTs after current profile verification is revoked or the auth user is deleted', async () => {
    expect((await users[4].client.from('profiles').update({ verified: true }).eq('id', users[4].id)).error?.code).toBe('42501');
    // Trusted administrative revocation, independent of the claims in the old JWT.
    expect((await clients.admin.from('profiles').update({ verified: false }).eq('id', users[4].id)).error).toBeNull();
    expect((await users[4].client.rpc('create_document', { p_title: 'blocked', p_content: '' })).error?.code).toBe('42501');
    const deleted = await clients.admin.auth.admin.deleteUser(users[4].id);
    expect(deleted.error).toBeNull();
    expect((await users[4].client.rpc('create_document', { p_title: 'deleted', p_content: '' })).error?.code).toBe('42501');
    users.pop();
  });
});
