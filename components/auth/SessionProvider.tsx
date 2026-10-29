'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { DemoPersona } from '@/lib/auth/types';
import type { ErrorCode } from '@/lib/http/errors';
import { apiFetch, clearSessionSnapshot, loadSessionSnapshot, onSessionInvalidated, setSessionSnapshot, type SessionSnapshot } from '@/lib/http/client';
interface SessionState {
 snapshot:SessionSnapshot|null; status:'checking'|'ready'|'error'; error:string; notice:string;
 refresh:()=>Promise<void>; reportError:(error:string)=>void; suspend:()=>void; start:(kind:'guest'|'demo',persona?:DemoPersona)=>Promise<void>;
 switchPersona:(persona:DemoPersona)=>Promise<void>; end:()=>Promise<void>;
}
const Context=createContext<SessionState|null>(null);
export function SessionProvider({children}:{children:React.ReactNode}) {
 const [snapshot,setSnapshot]=useState<SessionSnapshot|null>(null);
 const [status,setStatus]=useState<SessionState['status']>('checking');
 const [error,setError]=useState(''); const [notice,setNotice]=useState('');
 const serial=useRef(0);const transitioning=useRef(false);const previous=useRef<SessionSnapshot|null>(null);
 const accept=useCallback((next:SessionSnapshot)=>{previous.current=next;setSessionSnapshot(next);setSnapshot(next);setStatus('ready');setError('');},[]);
 const refresh=useCallback(async ()=>{
  if(transitioning.current)return;
  const request=++serial.current; setStatus('checking'); clearSessionSnapshot();
  try {
   const next=await loadSessionSnapshot(); if(request!==serial.current)return;
   if(next.code==='SESSION_EXPIRED')setNotice('Your guest session has expired.');
   if(next.code==='DEMO_RESET')setNotice('The demo has reset. Open a fresh document from the dashboard.');
   const before=previous.current?.session;
   if(before?.kind==='guest'&&!next.session)setNotice('Your guest session has expired.');
   const reset=before?.kind==='demo'&&next.session?.kind==='demo'&&before.workspaceId===next.session.workspaceId&&before.generation!==next.session.generation;
   accept(next);
   if((reset||next.code==='DEMO_RESET')&&window.location.pathname.startsWith('/documents/'))window.location.replace('/');
  }catch(error){if(request!==serial.current)return;setSnapshot(null);setStatus('error');setError(error instanceof Error?error.message:'Session unavailable.');}
 },[accept]);
 useEffect(()=>{
  let active=true;void Promise.resolve().then(()=>{if(active)void refresh();});
  const focus=()=>{void refresh();};
  const visible=()=>{if(document.visibilityState==='visible')void refresh();};
  window.addEventListener('focus',focus);window.addEventListener('online',focus);document.addEventListener('visibilitychange',visible);
  const remove=onSessionInvalidated(code=>{
   if(!code)return;
   if(code==='SESSION_EXPIRED')setNotice('Your guest session has expired.');
   if(code==='DEMO_RESET')setNotice('The demo has reset. Open a fresh document from the dashboard.');
   void refresh().then(()=>{if(code==='DEMO_RESET'&&window.location.pathname.startsWith('/documents/'))window.location.replace('/');});
  });
  return()=>{active=false;remove();window.removeEventListener('focus',focus);window.removeEventListener('online',focus);document.removeEventListener('visibilitychange',visible);clearSessionSnapshot();};
 },[refresh]);
 // A browser deadline asks the server to confirm expiry. It never deletes data.
 useEffect(()=>{
  const session=snapshot?.session;if(!session||session.kind==='user'||status!=='ready')return;
  const delay=Math.max(0,Date.parse(session.expiresAt)-Date.parse(snapshot!.serverNow));
  const timer=setTimeout(()=>{void refresh();},Math.min(delay+1000,2_147_483_647));return()=>clearTimeout(timer);
 },[snapshot,status,refresh]);
 const transition=async(path:string,input?:unknown,method='POST')=>{
  transitioning.current=true;serial.current++;setStatus('checking');setNotice('');
  try{const result=await apiFetch<SessionSnapshot>(path,{method,...(input?{body:JSON.stringify(input)}:{})});
   transitioning.current=false;if(result?.csrfToken)accept(result);else await refresh();
  }catch(error){transitioning.current=false;await refresh();setError(error instanceof Error?error.message:'Please try again.');throw error;}
 };
 const value:SessionState={snapshot,status,error,notice,refresh,reportError:setError,suspend:()=>{setStatus('checking');clearSessionSnapshot();},
  start:(kind,persona)=>transition('/api/session',{kind,...(kind==='demo'?{persona}:{})}),
  switchPersona:persona=>transition('/api/session/persona',{persona}),
  end:()=>transition('/api/session',undefined,'DELETE'),
 };
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSession():SessionState { const context=useContext(Context);if(!context)throw new Error('SessionProvider is required.');return context; }
export function SessionStatus(){const {status,error,notice,refresh}=useSession();return <>{notice&&<p role="status" className="p-4 text-sm bg-amber-50 text-amber-900">{notice}</p>}{status==='checking'&&<p role="status" className="p-10 text-center text-zinc-500">Checking your session…</p>}{error&&status!=='checking'&&<div role="alert" className="p-10 text-center"><p>{error}</p><button onClick={()=>void refresh()} className="mt-3 text-indigo-600">Try again</button></div>}</>;}
export function isSessionBoundaryCode(code:ErrorCode):boolean{return ['SESSION_EXPIRED','DEMO_RESET','UNAUTHENTICATED','VERIFICATION_REQUIRED'].includes(code);}
