vi.mock('server-only',()=>({}));
import { createHash, randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { integrationClients, seedVerifiedUser } from '../helpers/supabase';

/** Never falls back to remote credentials or silently skips an unavailable stack. */
describe('temporary workspace authorization', () => {
  let clients: ReturnType<typeof integrationClients>;
  const hashes: string[] = [];
  beforeAll(() => { clients = integrationClients(); });
  afterAll(async () => { if (clients) for (const hash of hashes) await clients.admin.rpc('temporary_end', {p_token_hash:hash}); });
  async function start(kind = 'demo', persona: string | null = 'alice') {
    const hash = createHash('sha256').update(randomBytes(32)).digest('hex'); hashes.push(hash);
    const result = await clients.admin.rpc('temporary_start', { p_token_hash: hash, p_kind: kind, p_persona: persona });
    expect(result.error).toBeNull();
    expect(JSON.stringify(result.data)).not.toContain(hash);
    return { hash, actor: result.data };
  }
  async function call(name: string, hash: string, generation: number, args = {}) {
    return clients.admin.rpc(name, { p_token_hash: hash, p_expected_generation: generation, ...args });
  }
  it('isolates two Alice visitors, rejects guessed credentials, and denies anonymous RPC calls', async () => {
    const a = await start(); const b = await start();
    expect(a.actor.workspaceId).not.toBe(b.actor.workspaceId);
    const made = await call('temporary_create', a.hash, a.actor.generation, { p_input: { title: 'Private', content: '<p>One visitor</p>' } });
    expect(made.error).toBeNull();
    expect((await call('temporary_get', b.hash, b.actor.generation, { p_id: made.data.id })).error?.message).toBe('NOT_FOUND');
    expect((await call('temporary_get', '0'.repeat(64), 1, { p_id: made.data.id })).error?.message).toBe('SESSION_EXPIRED');
    const anonymous = await clients.anon.rpc('temporary_get', { p_token_hash: a.hash, p_expected_generation: a.actor.generation, p_id: made.data.id });
    expect(anonymous.error).not.toBeNull();
    expect((await clients.anon.schema('temporary_private').from('documents').select('*')).error).not.toBeNull();
  });
  it('keeps guests empty, forbids persona switching and sharing, enforces generation and quotas', async () => {
    const a = await start('guest', null);
    expect((await call('temporary_list', a.hash, 1)).data).toEqual([]);
    expect((await clients.admin.rpc('temporary_persona', { p_token_hash: a.hash, p_expected_generation: 1, p_persona: 'bob' })).error?.message).toBe('FORBIDDEN');
    const made = await call('temporary_create', a.hash, 1, { p_input: { title: 'Guest', content: '' } });
    expect(made.error).toBeNull();
    expect((await call('temporary_grant_share', a.hash, 1, { p_id: made.data.id, p_recipient: { persona: 'bob' }, p_permission: 'edit' })).error?.message).toBe('FORBIDDEN');
    expect((await call('temporary_get', a.hash, 2, { p_id: made.data.id })).error?.message).toBe('DEMO_RESET');
    expect((await call('temporary_update', a.hash, 1, { p_id: made.data.id, p_input: { content: 'x'.repeat(1048577) } })).error?.message).toBe('QUOTA_EXCEEDED');
    const creates = await Promise.all(Array.from({ length: 25 }, () => call('temporary_create', a.hash, 1, { p_input: { title: 'Concurrent', content: '' } })));
    expect(creates.filter(r => !r.error)).toHaveLength(19);
    expect(creates.filter(r => r.error).every(r => r.error?.message === 'QUOTA_EXCEEDED')).toBe(true);
    expect((await call('temporary_list', a.hash, 1)).data).toHaveLength(20);
    for (let i = 0; i < 55; i++) expect((await call('temporary_update', a.hash, 1, { p_id: made.data.id, p_input: { content: `<p>${i}</p>`, createVersion: true } })).error).toBeNull();
    expect((await call('temporary_get', a.hash, 1, { p_id: made.data.id })).data.history).toHaveLength(50);
  });
  it('enforces owner, editor, viewer rights inside each operation and persists persona selection', async () => {
    const a = await start();
    const made = await call('temporary_create', a.hash, 1, { p_input: { title: 'Owner', content: '<p>Initial</p>' } });
    const share = await call('temporary_grant_share', a.hash, 1, { p_id: made.data.id, p_recipient: { persona: 'bob' }, p_permission: 'view' });
    expect(share.error).toBeNull();
    expect((await clients.admin.rpc('temporary_persona', { p_token_hash: a.hash, p_expected_generation: 1, p_persona: 'bob' })).error).toBeNull();
    expect((await call('temporary_get', a.hash, 1, { p_id: made.data.id })).data.permissions.role).toBe('viewer');
    expect((await call('temporary_update', a.hash, 1, { p_id: made.data.id, p_input: { title: 'Denied' } })).error?.message).toBe('FORBIDDEN');
    expect((await call('temporary_remove', a.hash, 1, { p_id: made.data.id })).error?.message).toBe('FORBIDDEN');
    expect((await call('temporary_get', a.hash, 1, { p_id: made.data.id })).data.title).toBe('Owner');
    await clients.admin.rpc('temporary_persona', { p_token_hash: a.hash, p_expected_generation: 1, p_persona: 'alice' });
    await call('temporary_revoke_share', a.hash, 1, { p_id: made.data.id, p_share_id: share.data.id });
    await clients.admin.rpc('temporary_persona', { p_token_hash: a.hash, p_expected_generation: 1, p_persona: 'bob' });
    expect((await call('temporary_get', a.hash, 1, { p_id: made.data.id })).error?.message).toBe('NOT_FOUND');
  });
  it('never reads or mutates persistent records through a temporary credential', async () => {
    const user=await seedVerifiedUser(clients.admin,clients.signIn(),'temporary-boundary');
    try {
      const persistent=await clients.admin.from('documents').insert({owner_id:user.id,title:'Persistent only',content:'<p>Real account</p>'}).select('id').single();
      expect(persistent.error).toBeNull();
      const guest=await start('guest',null); const id=persistent.data!.id;
      expect((await call('temporary_get',guest.hash,1,{p_id:id})).error?.message).toBe('NOT_FOUND');
      expect((await call('temporary_update',guest.hash,1,{p_id:id,p_input:{title:'Forbidden'}})).error?.message).toBe('NOT_FOUND');
      expect((await call('temporary_remove',guest.hash,1,{p_id:id})).error?.message).toBe('NOT_FOUND');
      expect((await clients.admin.from('documents').select('title').eq('id',id).single()).data?.title).toBe('Persistent only');
    } finally { await clients.admin.auth.admin.deleteUser(user.id); }
  });

});

it('opens every seeded demo through the strict application UUID contract',async()=>{
 const clients=integrationClients();const hash=createHash('sha256').update(randomBytes(32)).digest('hex');
 const {createTemporaryStore}=await import('../../lib/temporary/repository');
 const {z}=await import('zod');
 try{const start=await clients.admin.rpc('temporary_start',{p_token_hash:hash,p_kind:'demo',p_persona:'alice'});expect(start.error).toBeNull();
 const store=createTemporaryStore({tokenHash:hash,actor:start.data} as Parameters<typeof createTemporaryStore>[0],1);
 const docs=await store.list();expect(docs).toHaveLength(3);
 for(const doc of docs){expect(z.uuid().safeParse(doc.id).success).toBe(true);const detail=await store.get(doc.id);for(const revision of detail.history)expect(z.uuid().safeParse(revision.id).success).toBe(true);for(const share of detail.shares)expect(z.uuid().safeParse(share.id).success).toBe(true);}
 }finally{await clients.admin.rpc('temporary_end',{p_token_hash:hash});}
});
