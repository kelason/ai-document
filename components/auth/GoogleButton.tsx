'use client';
import { useState, useTransition } from 'react';
import { getAuthCsrfToken, signInWithGoogle } from '@/app/auth/actions';
import { useSession } from './SessionProvider';
import { getSessionSnapshot, setSessionSnapshot } from '@/lib/http/client';
import Button from '@/components/atoms/Button';
export default function GoogleButton({returnTo='/'}:{returnTo?:string}) {
 const {status}=useSession();
 const [pending,startTransition]=useTransition();const [error,setError]=useState('');
 return <div><Button className="w-full" variant="secondary" loading={pending} disabled={status!=='ready'} onClick={()=>startTransition(async()=>{
  setError('');try {const csrf=await getAuthCsrfToken();if(!csrf.ok){setError(csrf.error);return;}
  const current=getSessionSnapshot();if(current&&!current.session)setSessionSnapshot({...current,csrfToken:csrf.csrfToken});
  const result=await signInWithGoogle({csrfToken:csrf.csrfToken,returnTo});if(!result.ok){setError(result.error);return;}
  if(result.redirectTo)window.location.assign(result.redirectTo);
  }catch{setError('Google sign-in is temporarily unavailable. Please try again.');}
 })}>Continue with Google</Button>{error&&<p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}</div>;
}
