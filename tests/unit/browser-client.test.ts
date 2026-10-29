import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch, setSessionSnapshot, clearSessionSnapshot, type SessionSnapshot } from '../../lib/http/client';
const guest: SessionSnapshot = { session: { kind:'guest',workspaceId:'workspace',sessionId:'session',generation:7,expiresAt:'2026-10-28T00:00:00Z' }, csrfToken:'csrf-bound-token',serverNow:'2026-10-27T00:00:00Z' };
afterEach(() => { clearSessionSnapshot(); vi.unstubAllGlobals(); });
describe('browser request boundary', () => {
 it('adds bound CSRF and generation to mutations without caller identity', async () => {
  setSessionSnapshot(guest); let sent: RequestInit | undefined;
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => { sent=init; return Response.json({title:'Saved'}); });
  expect(await apiFetch('/api/documents/one',{method:'PATCH',body:JSON.stringify({title:'Saved'})})).toEqual({title:'Saved'});
  expect(new Headers(sent?.headers).get('X-CSRF-Token')).toBe('csrf-bound-token');
  expect(new Headers(sent?.headers).get('X-Workspace-Generation')).toBe('7');
  expect(sent?.credentials).toBe('same-origin'); expect(sent?.redirect).toBe('error');
 });
 it.each(['https://evil.test/api/documents','//evil.test/api/documents','/auth/callback','/api/../../outside','/api/\\evil'])('refuses token forwarding to %s',async path => {
  setSessionSnapshot(guest); const network=vi.fn(); vi.stubGlobal('fetch',network);
  await expect(apiFetch(path,{method:'POST'})).rejects.toThrow(); expect(network).not.toHaveBeenCalled();
 });
 it('refuses mutations until the server supplies a token',async () => {
  const network=vi.fn(); vi.stubGlobal('fetch',network);
  await expect(apiFetch('/api/documents',{method:'POST'})).rejects.toThrow(); expect(network).not.toHaveBeenCalled();
 });
 it('discards an in-flight result after a session change',async () => {
  setSessionSnapshot(guest); let finish!: (response:Response)=>void;
  vi.stubGlobal('fetch', () => new Promise<Response>(resolve => { finish=resolve; }));
  const pending=apiFetch('/api/documents/one'); clearSessionSnapshot(); finish(Response.json({content:'stale secret'}));
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
 });
 it('invalidates cached authorization on reset and exposes the typed error',async () => {
  setSessionSnapshot(guest); vi.stubGlobal('fetch',async () => Response.json({code:'DEMO_RESET',error:'Demo reset'},{status:409}));
  await expect(apiFetch('/api/documents/one')).rejects.toMatchObject({code:'DEMO_RESET'});
  await expect(apiFetch('/api/documents',{method:'POST'})).rejects.toThrow();
 });
});

it('refreshes a rejected CSRF token once and replays only under the same actor and generation',async()=>{
 setSessionSnapshot(guest);let writes=0;
 vi.stubGlobal('fetch',async(path:string)=>{
  if(path==='/api/session')return Response.json({...guest,csrfToken:'fresh-token'});
  writes++;return writes===1?Response.json({code:'FORBIDDEN',error:'Expired token',refreshCsrf:true},{status:403}):Response.json({saved:true});
 });
 expect(await apiFetch('/api/documents/one',{method:'PATCH',body:'{"content":"draft"}'})).toEqual({saved:true});expect(writes).toBe(2);
});
it('never replays a pending mutation into a different generation',async()=>{
 setSessionSnapshot(guest);let writes=0;
 vi.stubGlobal('fetch',async(path:string)=>{if(path==='/api/session')return Response.json({...guest,session:{...guest.session,generation:8},csrfToken:'fresh-token'});writes++;return Response.json({code:'FORBIDDEN',refreshCsrf:true},{status:403});});
 await expect(apiFetch('/api/documents/one',{method:'PATCH',body:'{"content":"old"}'})).rejects.toMatchObject({code:'DEMO_RESET'});expect(writes).toBe(1);
});
