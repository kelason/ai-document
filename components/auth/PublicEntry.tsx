'use client';
import Link from 'next/link';
import { useState } from 'react';
import Button from '@/components/atoms/Button';
import GoogleButton from './GoogleButton';
import { useSession } from './SessionProvider';
import { DEMO_PERSONAS } from '@/lib/constants';
export default function PublicEntry(){
 const {start}=useSession();const [pending,setPending]=useState(false);const [error,setError]=useState('');
 const begin=async(kind:'guest'|'demo',persona?:'alice'|'bob'|'charlie')=>{setPending(true);setError('');try{await start(kind,persona);}catch(error){setError(error instanceof Error?error.message:'Unable to start workspace.');}finally{setPending(false);}};
 return <main className="flex-1 bg-zinc-50 dark:bg-zinc-950 px-5 py-16"><div className="mx-auto max-w-xl rounded-3xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-8 space-y-6 shadow-sm">
 <div><h1 className="text-3xl font-bold">AI Docs</h1><p className="mt-3 text-zinc-500">Write, import, and collaborate in a shared document workspace.</p></div>
 <GoogleButton/><div className="flex gap-4"><Link href="/login" className="text-indigo-600 font-semibold">Log in with email</Link><Link href="/signup" className="text-indigo-600 font-semibold">Create account</Link></div>
 <div className="border-t border-zinc-200 dark:border-zinc-800 pt-5 space-y-3"><Button loading={pending} onClick={()=>void begin('guest')}>Continue as guest</Button><p className="text-sm text-zinc-500">Guest work expires five hours after you start. Create and verify an account to save it permanently.</p></div>
 <div className="space-y-3"><h2 className="font-semibold">Explore a private demo</h2><p className="text-sm text-zinc-500">Your demo workspace is isolated from other visitors and resets at midnight Philippine time.</p><div className="flex flex-wrap gap-2">{DEMO_PERSONAS.map(profile=><Button variant="secondary" key={profile.persona} disabled={pending} onClick={()=>void begin('demo',profile.persona)}>Try {profile.label} demo</Button>)}</div></div>
 {error&&<p role="alert" className="text-red-600 text-sm">{error}</p>}</div></main>;
}
