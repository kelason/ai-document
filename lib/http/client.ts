import type { Actor } from '../auth/types';
import type { ErrorCode } from './errors';

export type BrowserSession = Exclude<Actor, {kind:'user'}> | {kind:'user';userId:string;displayName:string;email:string};
export interface SessionSnapshot { session: BrowserSession | null; csrfToken:string; serverNow:string; canClaimGuest?:boolean; guestClaim?:{expiresAt:string}|null }
export class ClientApiError extends Error {
 constructor(public code:ErrorCode, message:string, public status:number) { super(message); this.name='ClientApiError'; }
}
let snapshot:SessionSnapshot|null=null;
let revision=0;
const requests=new Set<AbortController>();
const invalidationListeners=new Set<(code?:ErrorCode)=>void>();
export function sessionKey(session:BrowserSession|null):string {
 if (!session) return 'public';
 return session.kind==='user'?`user:${session.userId}`:`${session.kind}:${session.sessionId}:${session.workspaceId}:${session.generation}:${session.kind==='demo'?session.persona:''}`;
}
export function setSessionSnapshot(next:SessionSnapshot):void {
 if (sessionKey(snapshot?.session??null)!==sessionKey(next.session)) clearSessionSnapshot();
 snapshot=next;
}
export function getSessionSnapshot():SessionSnapshot|null { return snapshot; }
export function clearSessionSnapshot(code?:ErrorCode):void {
 snapshot=null; revision++;
 for (const controller of requests) controller.abort();
 requests.clear();
 for (const listener of invalidationListeners) listener(code);
}
export function onSessionInvalidated(listener:(code?:ErrorCode)=>void):()=>void { invalidationListeners.add(listener); return ()=>{invalidationListeners.delete(listener);}; }
const securityErrors=new Set<ErrorCode>(['UNAUTHENTICATED','VERIFICATION_REQUIRED','SESSION_EXPIRED','DEMO_RESET']);
/** Only local API paths: bound browser CSRF tokens must never follow an external redirect. */
export async function apiFetch<T=unknown>(path:string, init:RequestInit={}):Promise<T> {
 if (!path.startsWith('/api/')||path.includes('\\')||/[\u0000-\u0020]/.test(path)) throw new Error('Only local API paths are allowed.');
 const url=new URL(path,'https://same-origin.invalid');
 if (url.origin!=='https://same-origin.invalid'||!url.pathname.startsWith('/api/')) throw new Error('Only local API paths are allowed.');
 const method=(init.method??'GET').toUpperCase();
 const headers=new Headers(init.headers);
 headers.delete('Authorization'); headers.delete('X-CSRF-Token'); headers.delete('X-Workspace-Generation');
 if (!['GET','HEAD','OPTIONS'].includes(method)) {
  if (!snapshot?.csrfToken) throw new ClientApiError('UNAUTHENTICATED','Refresh your session before continuing.',401);
  headers.set('X-CSRF-Token',snapshot.csrfToken);
  if(snapshot.session && snapshot.session.kind!=='user') headers.set('X-Workspace-Generation',String(snapshot.session.generation));
 }
 if (typeof init.body==='string'&&!headers.has('Content-Type')) headers.set('Content-Type','application/json');
 const controller=new AbortController(); const issuedAt=revision;
 const abort=()=>controller.abort(); init.signal?.addEventListener('abort',abort,{once:true});
 if(init.signal?.aborted) controller.abort(); requests.add(controller);
 try {
  const response=await fetch(path,{...init,method,headers,signal:controller.signal,credentials:'same-origin',cache:'no-store',redirect:'error'});
  if (issuedAt!==revision) throw new DOMException('Session changed.','AbortError');
  const body:unknown=response.status===204?undefined:await response.json();
  if(issuedAt!==revision) throw new DOMException('Session changed.','AbortError');
  if(!response.ok) {
   const data=body as {code?:ErrorCode;error?:string};
   const code=data?.code??'STORAGE_UNAVAILABLE';
   if(securityErrors.has(code)) clearSessionSnapshot(code);
   throw new ClientApiError(code,data?.error??'The request could not be completed.',response.status);
  }
  return body as T;
 } finally {requests.delete(controller);init.signal?.removeEventListener('abort',abort);}
}
/** Raw session GET is the only bootstrap request; error snapshots contain fresh safe CSRF. */
export async function loadSessionSnapshot():Promise<SessionSnapshot & {code?:ErrorCode}> {
 const response=await fetch('/api/session',{credentials:'same-origin',cache:'no-store',redirect:'error'});
 const body=await response.json();
 if(typeof body.csrfToken!=='string'||typeof body.serverNow!=='string'||!('session' in body)) throw new ClientApiError(body.code??'STORAGE_UNAVAILABLE',body.error??'Session unavailable.',response.status);
 if(!response.ok&&!securityErrors.has(body.code)) throw new ClientApiError(body.code??'STORAGE_UNAVAILABLE',body.error??'Session unavailable.',response.status);
 return body;
}
