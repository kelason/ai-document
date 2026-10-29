import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

// Only the framework's server-boundary marker is replaced in this Node runner.
vi.mock('server-only', () => ({}));

import { integrationClients } from '../helpers/supabase';
import { createPersistentStore } from '../../lib/documents/repository';
import { createTemporaryStore } from '../../lib/temporary/repository';
import type { TemporaryCredential } from '../../lib/temporary/sessions';
import type { DocumentStore } from '../../lib/documents/types';

// Store-level authorization matrix against the real local database. The HTTP
// layer (CSRF, limits, status mapping, no-store) is covered by
// tests/unit/document-api.test.ts; this suite proves the same operations hold
// when the store talks to real RLS/RPCs instead of mocks. Missing local keys
// throw in integrationClients, matching sibling suites: never skipped.
describe('document API authorization against the local database', () => {
  let clients: ReturnType<typeof integrationClients>;
  const userIds: string[] = [];
  const hashes: string[] = [];
  let owner: { id: string; store: DocumentStore; client: SupabaseClient };
  let editor: { id: string; store: DocumentStore; client: SupabaseClient };
  let viewer: { id: string; store: DocumentStore; client: SupabaseClient };
  let unrelated: { id: string; store: DocumentStore; client: SupabaseClient };
  let documentId: string;
  let otherDocumentId: string;

  async function makeUser(label: string) {
    const email = `${label}-${crypto.randomUUID()}@example.test`;
    const password = `Test-${crypto.randomUUID()}-!1a`;
    const created = await clients.admin.auth.admin.createUser({
      email, password, email_confirm: true, user_metadata: { display_name: label },
    });
    if (created.error || !created.data.user) throw created.error ?? new Error('Missing test user');
    userIds.push(created.data.user.id);
    const client: SupabaseClient = clients.signIn();
    const session = await client.auth.signInWithPassword({ email, password });
    if (session.error) throw session.error;
    return { id: created.data.user.id, store: createPersistentStore(client), client };
  }

  beforeAll(async () => {
    clients = integrationClients();
    const health = await clients.admin.from('profiles').select('id').limit(1);
    if (health.error) throw new Error(`Local database is unavailable or unmigrated: ${health.error.message}`);
    owner = await makeUser('api-owner');
    editor = await makeUser('api-editor');
    viewer = await makeUser('api-viewer');
    unrelated = await makeUser('api-unrelated');
    const created = await owner.store.create({ title: 'Protected', content: '<p>original</p>' });
    documentId = created.id;
    otherDocumentId = (await owner.store.create({ title: 'Other', content: '<p>other</p>' })).id;
    for (const [user, permission] of [[editor, 'edit'], [viewer, 'view']] as const) {
      const grant = await owner.client.rpc('grant_document_share', {
        p_document_id: documentId, p_user_id: user.id, p_permission: permission,
      }).single<{ id: string }>();
      expect(grant.error).toBeNull();
    }
  }, 60_000);

  afterAll(async () => {
    if (!clients) return;
    for (const hash of hashes) await clients.admin.rpc('temporary_end', { p_token_hash: hash });
    for (const id of userIds) {
      const deleted = await clients.admin.auth.admin.deleteUser(id);
      if (deleted.error && !deleted.error.message.includes('not found')) throw deleted.error;
    }
  });

  it('lists and reads only for owner/editor/viewer; unrelated and missing IDs are 404', async () => {
    for (const actor of [owner, editor, viewer]) {
      expect((await actor.store.list()).some((doc) => doc.id === documentId)).toBe(true);
      expect((await actor.store.get(documentId)).content).toContain('original');
    }
    expect((await unrelated.store.list()).some((doc) => doc.id === documentId)).toBe(false);
    await expect(unrelated.store.get(documentId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(owner.store.get(crypto.randomUUID())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('denies viewer mutations with FORBIDDEN and editor delete/share management', async () => {
    await expect(viewer.store.update(documentId, { title: 'bad' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(viewer.store.remove(documentId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(viewer.store.restore(documentId, crypto.randomUUID())).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(viewer.store.addAttachment(documentId, {
      filename: 'a.txt', mimeType: 'text/plain', sizeBytes: 1, url: `/attachments/${crypto.randomUUID()}`,
    })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(editor.store.remove(documentId)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(editor.store.grantShare(documentId, { userId: unrelated.id }, 'view')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect((await owner.store.get(documentId)).title).toBe('Protected');
  });

  it('rejects spoofed owner/updatedBy/userId fields before any mutation', async () => {
    const spoofedCreate = { title: 'Spoof', content: '', ownerId: unrelated.id } as unknown as Parameters<DocumentStore['create']>[0];
    await expect(owner.store.create(spoofedCreate)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const spoofedUpdate = { content: '<p>x</p>', updatedBy: 'Alice' } as unknown as Parameters<DocumentStore['update']>[1];
    await expect(owner.store.update(documentId, spoofedUpdate)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const spoofedPresence = { active: true, userId: unrelated.id } as unknown as Parameters<DocumentStore['heartbeat']>[1];
    await expect(owner.store.heartbeat(documentId, spoofedPresence)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect((await owner.store.list()).some((doc) => doc.title === 'Spoof')).toBe(false);
  });

  it('fails nested share/document and version/document mismatches as NOT_FOUND', async () => {
    const share = await owner.store.grantShare(documentId, { userId: unrelated.id }, 'view');
    await expect(owner.store.revokeShare(otherDocumentId, share.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect((await unrelated.store.get(documentId)).id).toBe(documentId);
    const otherDetail = await owner.store.get(otherDocumentId);
    await expect(owner.store.restore(documentId, otherDetail.history[0].id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await owner.store.revokeShare(documentId, share.id);
    await expect(unrelated.store.get(documentId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(unrelated.store.update(documentId, { title: 'stale' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(unrelated.store.heartbeat(documentId, { active: true })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('persists document and history atomically, sanitizes, and caps history at 50', async () => {
    const edited = await editor.store.update(documentId, { content: '<script>bad()</script><p>edited</p>', createVersion: true });
    expect(edited.content).toBe('<p>edited</p>');
    expect(edited.history.some((version) => version.content === '<p>edited</p>')).toBe(true);
    for (let i = 0; i < 55; i++) {
      await owner.store.update(documentId, { content: `<p>revision ${i}</p>`, createVersion: true });
    }
    const capped = await owner.store.get(documentId);
    expect(capped.history).toHaveLength(50);
    expect(capped.content).toBe('<p>revision 54</p>');
  }, 60_000);

  it('supports authorized presence and editor attachments with server-derived identity', async () => {
    await expect(viewer.store.heartbeat(documentId, { active: true, cursorOffset: 3 })).resolves.toEqual(expect.any(Array));
    const attachment = await editor.store.addAttachment(documentId, {
      filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 5, url: `/attachments/${crypto.randomUUID()}`,
    });
    expect(attachment.documentId).toBe(documentId);
    expect((await viewer.store.get(documentId)).attachments.some((item) => item.id === attachment.id)).toBe(true);
  });

  it('exercises guest and demo stores through temporary RPC authorization', async () => {
    async function startTemporary(kind: 'guest' | 'demo', persona: 'alice' | null) {
      const hash = createHash('sha256').update(randomBytes(32)).digest('hex');
      hashes.push(hash);
      const started = await clients.admin.rpc('temporary_start', { p_token_hash: hash, p_kind: kind, p_persona: persona });
      expect(started.error).toBeNull();
      const actor = started.data as TemporaryCredential['actor'];
      const credential = { tokenHash: hash, actor } as unknown as TemporaryCredential;
      return { store: createTemporaryStore(credential, actor.generation), actor, hash };
    }
    const guest = await startTemporary('guest', null);
    expect(await guest.store.list()).toEqual([]);
    const guestDoc = await guest.store.create({ title: 'Guest doc', content: '<p>guest</p>' });
    await expect(guest.store.grantShare(guestDoc.id, { persona: 'bob' }, 'view')).rejects.toMatchObject({ code: 'FORBIDDEN' });

    const demo = await startTemporary('demo', 'alice');
    const demoDoc = await demo.store.create({ title: 'Demo doc', content: '<p>demo</p>' });
    const demoShare = await demo.store.grantShare(demoDoc.id, { persona: 'bob' }, 'view');
    expect(demoShare.permission).toBe('view');
    const switched = await clients.admin.rpc('temporary_persona', {
      p_token_hash: demo.hash, p_expected_generation: demo.actor.generation, p_persona: 'bob',
    });
    expect(switched.error).toBeNull();
    expect((await demo.store.get(demoDoc.id)).permissions.role).toBe('viewer');
    await expect(demo.store.update(demoDoc.id, { title: 'denied' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await clients.admin.rpc('temporary_persona', {
      p_token_hash: demo.hash, p_expected_generation: demo.actor.generation, p_persona: 'alice',
    });
    await demo.store.revokeShare(demoDoc.id, demoShare.id);
    await clients.admin.rpc('temporary_persona', {
      p_token_hash: demo.hash, p_expected_generation: demo.actor.generation, p_persona: 'bob',
    });
    await expect(demo.store.get(demoDoc.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    const stale = createTemporaryStore(
      { tokenHash: demo.hash, actor: demo.actor } as unknown as TemporaryCredential,
      demo.actor.generation + 100,
    );
    await expect(stale.list()).rejects.toMatchObject({ code: 'DEMO_RESET' });
  });
});
