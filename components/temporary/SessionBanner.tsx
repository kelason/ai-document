'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSession } from '@/components/auth/SessionProvider';
export default function SessionBanner(){
 const {snapshot,refresh}=useSession();const session=snapshot?.session;
 const [elapsed,setElapsed]=useState(0);
 useEffect(()=>{const start=performance.now();const timer=setInterval(()=>setElapsed(performance.now()-start),1000);return()=>clearInterval(timer);},[snapshot]);
 if(!session||session.kind==='user')return null;
 const remaining=Date.parse(session.expiresAt)-Date.parse(snapshot!.serverNow)-elapsed;
 const warning=remaining<=5*60*1000;
 return <aside role="status" className={`px-5 py-3 text-sm flex flex-wrap items-center gap-3 border-b ${warning?'bg-amber-50 text-amber-900 border-amber-200':'bg-indigo-50 text-indigo-900 border-indigo-100'}`}>
 <span>{session.kind==='guest'?(warning?'Your guest workspace expires in less than five minutes.':'Guest work expires five hours after this session started.'):'Private demo · resets at midnight Philippine time.'}</span>
 {session.kind==='guest'&&<><Link className="underline font-semibold" href="/signup?next=%2F">Save with an account</Link><Link className="underline" href="/login?next=%2F">Log in</Link></>}
 {remaining<=0&&<button onClick={()=>void refresh()} className="underline">Check session</button>}
 </aside>;
}
