'use client';
import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import { getAuthCsrfToken, signInWithPassword, signUp, resendVerification, requestPasswordReset, updatePassword, type AuthActionResult } from '@/app/auth/actions';
import GoogleButton from './GoogleButton';
import Button from '@/components/atoms/Button';
import { SessionStatus, useSession } from './SessionProvider';
import { getSessionSnapshot, setSessionSnapshot, clearSessionSnapshot } from '@/lib/http/client';
export type AuthFormKind='login'|'signup'|'verify-email'|'forgot-password'|'reset-password';
const titles:Record<AuthFormKind,string>={login:'Log in to AI Docs',signup:'Create your account','verify-email':'Verify your email','forgot-password':'Reset your password','reset-password':'Choose a new password'};
export default function AuthForm({kind}:{kind:AuthFormKind}){
 const {status,snapshot,refresh}=useSession();
 const rememberToken=(token:string)=>{const current=getSessionSnapshot()??snapshot;if(current&&!current.session)setSessionSnapshot({...current,csrfToken:token});setCsrfToken(token);};
 const [csrfToken,setCsrfToken]=useState('');const [error,setError]=useState('');const [message,setMessage]=useState('');const [returnTo,setReturnTo]=useState('/');
 const [pending,startTransition]=useTransition();
 const bootstrap=()=>startTransition(async()=>{try{const token=await getAuthCsrfToken();if(token.ok){rememberToken(token.csrfToken);setError('');}else setError(token.error);}catch{setError('Authentication is temporarily unavailable. Try again.');}});
 useEffect(()=>{if(status!=='ready')return;let active=true;void Promise.resolve().then(()=>{if(!active)return;const query=new URLSearchParams(window.location.search);if(query.has('error'))setError('The sign-in link could not be used. Try logging in or request a fresh email.');const next=query.get('next');if(next)setReturnTo(next);startTransition(async()=>{try{const result=await getAuthCsrfToken();if(result.ok){setCsrfToken(result.csrfToken);const current=getSessionSnapshot();if(current&&!current.session)setSessionSnapshot({...current,csrfToken:result.csrfToken});}else setError(result.error);}catch{setError('Authentication is temporarily unavailable. Try again.');}});});return()=>{active=false;};},[status]);
 const submit=(event:React.FormEvent<HTMLFormElement>)=>{
  event.preventDefault();const data=new FormData(event.currentTarget);setError('');setMessage('');
  startTransition(async()=>{
   const email=String(data.get('email')??'');const password=String(data.get('password')??'');
   try{
    const base={csrfToken,returnTo};let result:AuthActionResult;
    switch(kind){
     case 'login': result=await signInWithPassword({...base,email,password});break;
     case 'signup':result=await signUp({...base,email,password,displayName:String(data.get('displayName')??'')});break;
     case 'verify-email':result=await resendVerification({...base,email});break;
     case 'forgot-password':result=await requestPasswordReset({...base,email});break;
     case 'reset-password':result=await updatePassword({...base,password});break;
    }
    if(!result.ok){setError(result.error);if(result.code==='VERIFICATION_REQUIRED')window.location.replace('/verify-email');return;}
    clearSessionSnapshot();
    if(kind==='login'){window.location.assign(result.redirectTo??'/');return;}
    await refresh();
    if(kind==='signup'){setMessage('Check your inbox to verify your email before opening your permanent workspace.');}
    else setMessage(result.message??'Your request was received.');
    const token=await getAuthCsrfToken();if(token.ok)rememberToken(token.csrfToken);
   }catch{setError('Your request could not be completed. Please try again.');}
  });
 };
 const needsEmail=kind!=='reset-password';const needsPassword=['login','signup','reset-password'].includes(kind);
 return <><SessionStatus/><main className="min-h-screen bg-zinc-50 dark:bg-zinc-950 px-5 py-12"><div className="mx-auto max-w-md bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-3xl p-8 space-y-5">
 <Link href="/" className="text-indigo-600 font-semibold">AI Docs</Link><h1 className="text-2xl font-bold">{titles[kind]}</h1>
 {kind==='verify-email'&&<p className="text-sm text-zinc-500">Open the verification link in your inbox, then log in. Your documents stay unavailable until your email is verified.</p>}
 {['login','signup'].includes(kind)&&<GoogleButton returnTo={returnTo}/>}
 <form onSubmit={submit} className="space-y-4">
 {kind==='signup'&&<label className="block text-sm font-medium">Display name<input name="displayName" required maxLength={100} autoComplete="name" className="mt-1 w-full border border-zinc-300 dark:border-zinc-700 rounded-xl p-2 bg-transparent"/></label>}
 {needsEmail&&<label className="block text-sm font-medium">Email address<input name="email" type="email" autoComplete="email" required maxLength={254} className="mt-1 w-full border border-zinc-300 dark:border-zinc-700 rounded-xl p-2 bg-transparent"/></label>}
 {needsPassword&&<label className="block text-sm font-medium">Password<input name="password" type="password" required minLength={kind==='login'?1:12} maxLength={128} autoComplete={kind==='login'?'current-password':'new-password'} aria-describedby={kind==='login'?undefined:'password-help'} className="mt-1 w-full border border-zinc-300 dark:border-zinc-700 rounded-xl p-2 bg-transparent"/></label>}
 {needsPassword&&kind!=='login'&&<p id="password-help" className="text-xs text-zinc-500">Use at least 12 characters.</p>}
 <Button type="submit" loading={pending} disabled={!csrfToken||status!=='ready'} className="w-full">{kind==='login'?'Log in':kind==='signup'?'Create account':kind==='verify-email'?'Resend verification email':kind==='forgot-password'?'Send reset email':'Save new password'}</Button>
 </form>
 {error&&<div role="alert" className="text-sm text-red-600">{error}{!csrfToken&&<button onClick={bootstrap} className="block mt-2 underline">Try again</button>}</div>}
 {message&&<p role="status" className="text-sm text-emerald-700">{message}</p>}
 <div className="flex flex-wrap gap-4 text-sm text-indigo-600"><Link href="/login">Log in</Link><Link href="/signup">Create account</Link><Link href="/forgot-password">Forgot password?</Link></div>
 <p className="text-xs text-zinc-500">After verifying and logging in, choose Save guest work in the workspace header to keep an active guest draft.</p>
 </div></main></>;
}
