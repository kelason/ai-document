import {createHash,randomBytes} from 'node:crypto';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {integrationClients,seedVerifiedUser} from '../helpers/supabase';
import {localSql} from '../helpers/sql';

describe('guest transfer transactions on isolated Supabase',()=>{
 let clients:ReturnType<typeof integrationClients>;let user:Awaited<ReturnType<typeof seedVerifiedUser>>;
 const hashes:string[]=[];
 beforeAll(async()=>{clients=integrationClients();user=await seedVerifiedUser(clients.admin,clients.signIn(),'guest-claim');});
 afterAll(async()=>{if(clients){for(const hash of hashes)await clients.admin.rpc('temporary_end',{p_token_hash:hash});if(user)await clients.admin.auth.admin.deleteUser(user.id);}});
 async function source(){
  const hash=createHash('sha256').update(randomBytes(32)).digest('hex');hashes.push(hash);
  expect((await clients.admin.rpc('temporary_start',{p_token_hash:hash,p_kind:'guest',p_persona:null})).error).toBeNull();
  const made=await clients.admin.rpc('temporary_create',{p_token_hash:hash,p_expected_generation:1,p_input:{title:'Transfer fixture',content:'<p>Safe</p>'}});expect(made.error).toBeNull();
  const args={p_token_hash:hash,p_user_id:user.id};
  const prepared=await clients.admin.rpc('prepare_guest_claim',args);expect(prepared.error).toBeNull();
  return {hash,id:made.data.id,args:{...args,p_snapshot_hash:prepared.data.snapshotHash,p_documents:prepared.data.documents}};
 }
 it('serializes two initial claims into a single complete transfer and receipt',async()=>{
  const s=await source();
  const [a,b]=await Promise.all([clients.admin.rpc('claim_guest_workspace',s.args),clients.admin.rpc('claim_guest_workspace',s.args)]);
  expect(a.error).toBeNull();expect(b.error).toBeNull();expect(a.data).toEqual(b.data);expect(a.data.documentIds).toHaveLength(1);expect(a.data.documentIds[0]).not.toBe(s.id);
  const rows=await clients.admin.from('documents').select('owner_id,content').in('id',a.data.documentIds);expect(rows.data).toEqual([{owner_id:user.id,content:'<p>Safe</p>'}]);
  expect((await clients.admin.rpc('temporary_session',{p_token_hash:s.hash})).error?.message).toBe('SESSION_EXPIRED');
 });
 it('rejects a source edited between prepare and claim, preserving all source rows',async()=>{
  const s=await source();expect((await clients.admin.rpc('temporary_update',{p_token_hash:s.hash,p_expected_generation:1,p_id:s.id,p_input:{content:'<p>Changed</p>'}})).error).toBeNull();
  expect((await clients.admin.rpc('claim_guest_workspace',s.args)).error?.message).toBe('VALIDATION_ERROR');
  expect((await clients.admin.rpc('temporary_get',{p_token_hash:s.hash,p_expected_generation:1,p_id:s.id})).data.content).toBe('<p>Changed</p>');
 });
 it('rolls back a transfer which reaches COMMIT after the absolute deadline',async()=>{
  const s=await source();
  await localSql(`UPDATE temporary_private.workspaces SET expires_at=clock_timestamp()+interval '400 milliseconds' WHERE id=(SELECT workspace_id FROM temporary_private.sessions WHERE token_hash='${s.hash}');`);
  const body=JSON.stringify(s.args.p_documents).replaceAll("'","''");
  await expect(localSql(`BEGIN;SELECT claim_guest_workspace('${user.id}','${s.hash}','${s.args.p_snapshot_hash}','${body}'::jsonb);SELECT pg_sleep(0.6);COMMIT;`)).rejects.toThrow('SESSION_EXPIRED');
  expect(await localSql(`SELECT count(*) FROM temporary_private.documents WHERE id='${s.id}';`)).toBe('1');
  expect(await localSql(`SELECT count(*) FROM temporary_private.claim_receipts WHERE token_hash='${s.hash}';`)).toBe('0');
 });
 it('races cleanup against two claims with either one full copy or clean expiry',async()=>{
  const s=await source();
  await localSql(`UPDATE temporary_private.workspaces SET expires_at=clock_timestamp()+interval '60 milliseconds' WHERE id=(SELECT workspace_id FROM temporary_private.sessions WHERE token_hash='${s.hash}');`);
  const [a,b]=await Promise.all([clients.admin.rpc('claim_guest_workspace',s.args),clients.admin.rpc('claim_guest_workspace',s.args),localSql('SELECT pg_sleep(0.07);SELECT purge_expired_workspaces();')]);
  if(!a.error||!b.error){const winner=!a.error?a:b;expect(winner.data.documentIds).toHaveLength(1);if(!a.error&&!b.error)expect(a.data).toEqual(b.data);expect(await localSql(`SELECT count(*) FROM public.documents WHERE id='${winner.data.documentIds[0]}';`)).toBe('1');}
  else{expect(a.error.message).toBe('SESSION_EXPIRED');expect(b.error.message).toBe('SESSION_EXPIRED');expect(await localSql(`SELECT count(*) FROM temporary_private.claim_receipts WHERE token_hash='${s.hash}';`)).toBe('0');}
  expect(await localSql(`SELECT count(*) FROM temporary_private.documents WHERE id='${s.id}';`)).toBe('0');
 });
});
