'use client';
import { useState, useTransition } from 'react';
import Link from 'next/link';
import { getAuthCsrfToken, signOut } from '@/app/auth/actions';
import { apiFetch, clearSessionSnapshot } from '@/lib/http/client';
import { DEMO_PERSONAS } from '@/lib/constants';
import Button from '@/components/atoms/Button';
import { useSession } from './SessionProvider';
export default function AccountMenu(){
 const {snapshot,switchPersona,end,refresh,suspend,reportError}=useSession();const session=snapshot?.session;
 const [pending,startTransition]=useTransition();const [error,setError]=useState('');const [message,setMessage]=useState('');
 if(!session)return null;
 const run=(work:()=>Promise<void>)=>startTransition(async()=>{setError('');try{await work();}catch(error){const message=error instanceof Error?error.message:'Please try again.';setError(message);reportError(message);}});
 return <div className="flex flex-wrap items-center gap-2 text-xs">
 <span className="font-semibold">{session.kind==='user'?session.displayName:session.kind==='demo'?`${session.persona[0].toUpperCase()}${session.persona.slice(1)} demo`:'Guest'}</span>
 {session.kind==='demo'&&<label className="flex gap-2 items-center">Demo persona<select aria-label="Demo persona" value={session.persona} disabled={pending} onChange={event=>{const persona=DEMO_PERSONAS.find(p=>p.persona===event.target.value)?.persona;if(persona)run(async()=>{await switchPersona(persona);window.location.replace('/');});}} className="border border-zinc-300 dark:border-zinc-700 rounded-lg p-1 bg-transparent">{DEMO_PERSONAS.map(p=><option key={p.persona} value={p.persona}>{p.label}</option>)}</select></label>}
 {session.kind==='guest'&&<><Link href="/signup?next=%2F" className="text-indigo-600">Create account to save</Link><Link href="/login?next=%2F" className="text-indigo-600">Log in</Link></>}
 {session.kind==='user'&&(snapshot?.guestClaim||snapshot?.canClaimGuest)&&<Button size="sm" loading={pending} onClick={()=>run(async()=>{await apiFetch('/api/session/claim',{method:'POST',body:'{}'});setMessage('Guest work saved to your account.');await refresh();window.location.replace('/');})}>Save guest work</Button>}
 <Button variant="ghost" size="sm" loading={pending} onClick={()=>run(async()=>{
  if(session.kind==='user'){suspend();const token=await getAuthCsrfToken();if(!token.ok){await refresh();throw new Error(token.error);}const result=await signOut({csrfToken:token.csrfToken});if(!result.ok){await refresh();throw new Error(result.error);}clearSessionSnapshot();window.location.replace('/');}
  else{await end();window.location.replace('/');}
 })}>{session.kind==='user'?'Sign out':'End session'}</Button>
 {error&&<p role="alert" className="w-full text-red-600">{error}</p>}{message&&<p role="status">{message}</p>}</div>;
}
