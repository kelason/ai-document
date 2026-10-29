import { createHash } from 'node:crypto';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const state = vi.hoisted(() => ({ duplicates: [] as {name:string;value:string}[], cookies: new Map<string, string>(), settings: new Map<string, Record<string, unknown>>(), rpc: vi.fn(), profileSelect: vi.fn(), profile: {display_name:'Verified Name',email:'verified@example.test'}, authBinding: null as string | null, user: null as { userId: string } | null }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [...state.cookies].map(([name,value]) => ({ name,value })).concat(state.duplicates), set: (name: string,value: string,settings: Record<string,unknown>) => { state.cookies.set(name,value); state.settings.set(name,settings); } }) }));
vi.mock('../../lib/supabase/server', () => ({ createServerSupabaseClient: async () => ({ auth:{getUser:async()=>({data:{user:{id:state.user?.userId,email:'verified@example.test'}},error:null})}, from: () => ({ select: (columns:string) => {state.profileSelect(columns);return { eq: () => ({ single: async () => columns.includes('email')?({data:null,error:{code:'42501'}}):({data:state.profile,error:null}) }) };} }) }) }));
vi.mock('../../lib/supabase/admin', () => ({ createAdminSupabaseClient: () => ({ rpc: state.rpc }) }));
vi.mock('../../lib/auth/context', () => ({ getVerifiedUser: async () => state.user, getSessionBinding: async () => state.authBinding }));
vi.mock('../../lib/security/rate-limit', () => ({ hashLimitKey: (s: string,v: string) => s+v, trustedClientIp: () => '127.0.0.1', requireLimit: async () => {} }));
import { startTemporarySession, getTemporaryCredential, temporaryCookieName, getTemporarySession, switchDemoPersona, endTemporarySession } from '../../lib/temporary/sessions';
import { createTemporaryStore } from '../../lib/temporary/repository';
import { setSelectedMode } from '../../lib/auth/mode';
import { issueCsrf } from '../../lib/security/csrf';
import { GET, POST, DELETE as endSession } from '../../app/api/session/route';
import { POST as claimPost } from '../../app/api/session/claim/route';
import { POST as personaPost } from '../../app/api/session/persona/route';
const actor = { kind: 'guest' as const, workspaceId: '4e89a06b-2f64-4cb6-90f3-71594d503eda', sessionId: 'cab08246-06de-4432-8484-56f080050b1e', generation: 1, expiresAt: new Date(Date.now()+5*3600000).toISOString() };
beforeEach(() => { vi.clearAllMocks(); state.cookies.clear(); state.duplicates=[]; state.settings.clear(); state.authBinding=null; state.user=null; vi.stubEnv('APP_ORIGIN','https://docs.example.test'); vi.stubEnv('CSRF_SECRET','s'.repeat(64)); state.rpc.mockResolvedValue({ data: actor,error:null }); });
afterEach(() => vi.unstubAllEnvs());
function req(path: string, body?: unknown, csrf?: string, extra = {}) { return new Request(`https://docs.example.test${path}`, { method: body===undefined?'GET':'POST',headers: { origin:'https://docs.example.test','content-type':'application/json',cookie:[...state.cookies].map(([k,v])=>`${k}=${v}`).join('; '),...(csrf?{'x-csrf-token':csrf}:{}),...extra },body:body===undefined?undefined:JSON.stringify(body) }); }

describe('temporary credential boundary', () => {
 it('uses 32 random bytes, stores only SHA-256, and returns safe metadata',async()=>{
  const result=await startTemporarySession('guest'); const value=state.cookies.get(temporaryCookieName('guest'))!;
  expect(Buffer.from(value,'base64url')).toHaveLength(32);
  expect(state.rpc).toHaveBeenCalledWith('temporary_start',expect.objectContaining({p_token_hash:createHash('sha256').update(value).digest('hex')}));
  expect(result).toEqual(actor); expect(JSON.stringify(result)).not.toContain(value);
  expect(state.settings.get(temporaryCookieName('guest'))).toMatchObject({httpOnly:true,secure:true,sameSite:'lax',path:'/',expires:new Date(actor.expiresAt)});
 });
 it('rejects malformed cookies without a database call and never infers authority from selection',async()=>{
  await setSelectedMode('guest'); state.cookies.set(temporaryCookieName('guest'),'forged');
  expect(await getTemporarySession()).toBeNull(); expect(state.rpc).not.toHaveBeenCalled();
 });
 it('revalidates every store operation with hash and expected generation and sanitizes writes',async()=>{
  await startTemporarySession('guest'); const credential=(await getTemporaryCredential())!; state.rpc.mockClear();
  const store=createTemporaryStore(credential,7);
  await store.update(actor.workspaceId,{ content:'<p>Safe</p><script>bad()</script>' });
  expect(state.rpc).toHaveBeenCalledWith('temporary_update',{ p_token_hash:credential.tokenHash,p_expected_generation:7,p_id:actor.workspaceId,p_input:{content:'<p>Safe</p>'} });
  state.rpc.mockResolvedValue({data:null,error:{message:'DEMO_RESET'}});
  await expect(store.get(actor.workspaceId)).rejects.toMatchObject({code:'DEMO_RESET'});
 });
 it('maps unknown database errors safely, rejects null generation, and refuses guest persona changes',async()=>{
  await startTemporarySession('guest'); const credential=(await getTemporaryCredential())!;
  expect(()=>createTemporaryStore(credential,NaN)).toThrow();
  await expect(switchDemoPersona('bob',1)).rejects.toMatchObject({code:'FORBIDDEN'});
  state.rpc.mockResolvedValue({data:null,error:{message:'password=secret'}});
  await expect(createTemporaryStore(credential,1).list()).rejects.toMatchObject({code:'STORAGE_UNAVAILABLE',message:'Storage is temporarily unavailable.'});
 });
 it('keeps retained guest credentials when starting demo and clears only the selected workspace on end',async()=>{
  await startTemporarySession('guest'); const retained=state.cookies.get(temporaryCookieName('guest'));
  state.rpc.mockResolvedValue({data:{...actor,kind:'demo',persona:'alice'},error:null});
  await startTemporarySession('demo','alice'); expect(state.cookies.get(temporaryCookieName('guest'))).toBe(retained);
  await endTemporarySession(); expect(state.cookies.get(temporaryCookieName('demo'))).toBe(''); expect(state.cookies.get(temporaryCookieName('guest'))).toBe(retained);
 });
});
describe('session HTTP CSRF and metadata',()=>{
 it('rejects duplicate credential cookies and database mode mismatches',async()=>{
  await startTemporarySession('guest');
  state.duplicates=[{name:temporaryCookieName('guest'),value:state.cookies.get(temporaryCookieName('guest'))!}]; state.rpc.mockClear();
  expect(await getTemporaryCredential()).toBeNull(); expect(state.rpc).not.toHaveBeenCalled();
  state.duplicates=[]; state.rpc.mockResolvedValue({data:{...actor,kind:'demo',persona:'alice'},error:null});
  await expect(getTemporaryCredential()).rejects.toMatchObject({code:'SESSION_EXPIRED'});
 });
 it('refreshes demo cookie after valid GET while guest expiry never slides',async()=>{
  await startTemporarySession('guest'); const expiry=state.settings.get(temporaryCookieName('guest'))!.expires;
  await GET(req('/api/session')); expect(state.settings.get(temporaryCookieName('guest'))!.expires).toEqual(expiry);
  state.rpc.mockResolvedValue({data:{...actor,kind:'demo',persona:'alice'},error:null});
  await startTemporarySession('demo','alice'); state.settings.clear(); await GET(req('/api/session'));
  expect(state.settings.get(temporaryCookieName('demo'))).toMatchObject({maxAge:86400});
 });
 it('provides a fresh preauth bootstrap when the selected session expired',async()=>{
  await startTemporarySession('guest'); state.rpc.mockResolvedValue({data:null,error:{message:'SESSION_EXPIRED'}});
  const result=await GET(req('/api/session')); const body=await result.json();
  expect(result.status).toBe(410); expect(body).toMatchObject({session:null,code:'SESSION_EXPIRED'}); expect(body.csrfToken).toBeTypeOf('string'); expect(body.serverNow).toBeTypeOf('string');
  expect(result.headers.get('set-cookie')).toContain('preauth'); expect(result.headers.get('cache-control')).toBe('private, no-store');
 });
 it('uses current verified-profile display metadata and real-auth CSRF in user mode',async()=>{
  await startTemporarySession('guest'); const guest=state.cookies.get(temporaryCookieName('guest'));
  await setSelectedMode('user'); state.user={userId:actor.workspaceId}; state.authBinding='auth:verified-session';
  const result=await GET(req('/api/session')); const body=await result.json();
  expect(body.session).toEqual({kind:'user',userId:actor.workspaceId,displayName:'Verified Name',email:'verified@example.test'});
  expect(state.cookies.get(temporaryCookieName('guest'))).toBe(guest); expect(state.profileSelect).toHaveBeenCalledWith('display_name'); expect(body.guestClaim).toEqual({expiresAt:actor.expiresAt});
 });
 it('requires stale persona writes to carry their original generation through to SQL',async()=>{
  state.rpc.mockResolvedValue({data:{...actor,kind:'demo',persona:'alice'},error:null}); await startTemporarySession('demo','alice');
  const token=(await (await GET(req('/api/session'))).json()).csrfToken;
  state.rpc.mockImplementation(async(name:string)=>name==='temporary_persona'?{data:null,error:{message:'DEMO_RESET'}}:{data:{...actor,kind:'demo',persona:'alice'},error:null});
  const result=await personaPost(req('/api/session/persona',{persona:'bob'},token,{'x-workspace-generation':'7'}));
  expect(result.status).toBe(409); expect(state.rpc).toHaveBeenCalledWith('temporary_persona',expect.objectContaining({p_expected_generation:7}));
 });

 it('bootstraps no-session CSRF privately and rejects unauthenticated/cross-origin mutations',async()=>{
  const bootstrap=await GET(req('/api/session')); const body=await bootstrap.json();
  expect(body.session).toBeNull(); expect(body.csrfToken).toBeTypeOf('string'); expect(bootstrap.headers.get('cache-control')).toContain('no-store');
  const cookie=bootstrap.headers.get('set-cookie')!.split(';')[0]; state.cookies.set(cookie.split('=')[0],cookie.slice(cookie.indexOf('=')+1));
  expect((await POST(req('/api/session',{kind:'guest'},body.csrfToken,{origin:'https://evil.test'}))).status).toBe(403);
  expect((await POST(req('/api/session',{kind:'guest'}))).status).toBe(403);
  const result=await POST(req('/api/session',{kind:'guest'},body.csrfToken)); expect(result.status).toBe(201); expect((await result.json()).session).toEqual(actor);
 });
 it('returns validated temporary metadata and context-bound CSRF without hashes',async()=>{
  await startTemporarySession('guest'); const credential=(await getTemporaryCredential())!;
  const result=await GET(req('/api/session')); const body=await result.json(); expect(body.session).toEqual(actor); expect(JSON.stringify(body)).not.toContain(credential.tokenHash);
  const post=await POST(req('/api/session',{kind:'guest'},body.csrfToken)); expect(post.status).toBe(201);
 });
 it('accepts current real-auth CSRF when transitioning to temporary mode',async()=>{
  await setSelectedMode('user'); state.authBinding='auth:verified-session'; state.user={userId:actor.workspaceId};
  const result=await POST(req('/api/session',{kind:'guest'},issueCsrf(state.authBinding))); expect(result.status).toBe(201);
 });
 it('rejects stale persona generations and accepts only demo context',async()=>{
  await startTemporarySession('guest'); const token=(await (await GET(req('/api/session'))).json()).csrfToken;
  expect((await personaPost(req('/api/session/persona',{persona:'bob'},token,{'x-workspace-generation':'1'}))).status).toBe(403);
  expect((await personaPost(req('/api/session/persona',{persona:'bob'},token))).status).toBe(400);
 });
});

describe('explicit verified guest transfer',()=>{
 async function verifiedGuest(){await startTemporarySession('guest');await setSelectedMode('user');state.user={userId:actor.workspaceId};state.authBinding='auth:verified-session';return issueCsrf(state.authBinding);}
 it('requires verified account mode, real-auth CSRF, and empty strict input',async()=>{
  const token=await verifiedGuest();
  expect((await claimPost(req('/api/session/claim',{}))).status).toBe(403);
  expect((await claimPost(req('/api/session/claim',{userId:actor.sessionId},token))).status).toBe(400);
  await setSelectedMode('demo');expect((await claimPost(req('/api/session/claim',{},token))).status).toBe(403);
 });
 it('sanitizes document and revision content without accepting browser identity',async()=>{
  const token=await verifiedGuest();
  const resultIds={documentIds:[actor.sessionId]};
  state.rpc.mockImplementation(async(name:string)=>({error:null,data:name==='prepare_guest_claim'?{snapshotHash:'snapshot',documents:[{id:actor.workspaceId,content:'<p>Safe</p><script>bad()</script>',history:[{id:actor.sessionId,content:'<b onclick="bad()">Old</b>'}]}]}:resultIds}));
  const response=await claimPost(req('/api/session/claim',{},token));
  expect(response.status).toBe(200);expect(await response.json()).toEqual(resultIds);
  expect(state.rpc).toHaveBeenCalledWith('claim_guest_workspace',expect.objectContaining({p_user_id:actor.workspaceId,p_snapshot_hash:'snapshot',p_documents:[{id:actor.workspaceId,content:'<p>Safe</p>',history:[{id:actor.sessionId,content:'<b>Old</b>'}]}]}));
 });
 it('allows idempotent receipt replay without revalidating the consumed workspace',async()=>{
  const token=await verifiedGuest();state.rpc.mockResolvedValue({error:null,data:{receipt:{documentIds:[actor.sessionId]}}});
  const response=await claimPost(req('/api/session/claim',{},token));expect(response.status).toBe(200);
  expect(state.rpc).toHaveBeenLastCalledWith('prepare_guest_claim',expect.objectContaining({p_user_id:actor.workspaceId}));
 });
 it('returns 410 for expired source and never exposes database details',async()=>{
  const token=await verifiedGuest();state.rpc.mockResolvedValue({data:null,error:{message:'SESSION_EXPIRED'}});
  expect((await claimPost(req('/api/session/claim',{},token))).status).toBe(410);
 });
});

it('requires current CSRF to end the selected temporary session',async()=>{
 await startTemporarySession('guest');const token=(await (await GET(req('/api/session'))).json()).csrfToken;
 const make=(csrf?:string)=>new Request('https://docs.example.test/api/session',{method:'DELETE',headers:{origin:'https://docs.example.test',...(csrf?{'x-csrf-token':csrf}:{})}});
 expect((await endSession(make())).status).toBe(403);
 expect((await endSession(make(token))).status).toBe(204);
 expect(state.cookies.get(temporaryCookieName('guest'))).toBe('');
});
