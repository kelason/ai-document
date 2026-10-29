'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Share2, Trash2 } from 'lucide-react';
import Button from '@/components/atoms/Button';
import { DEMO_PERSONAS } from '@/lib/constants';
import { apiFetch } from '@/lib/http/client';
import type { DocumentPermissions, Share, SharePermission } from '@/lib/documents/types';
import { useSession } from '@/components/auth/SessionProvider';
interface ShareModalProps {documentId:string;documentTitle:string;ownerName:string;permissions:DocumentPermissions;onClose:()=>void}
export default function ShareModal({documentId,documentTitle,ownerName,permissions,onClose}:ShareModalProps){
 const {snapshot}=useSession();const session=snapshot?.session;
 const [shares,setShares]=useState<Share[]>([]);const [loading,setLoading]=useState(true);const [saving,setSaving]=useState(false);
 const [email,setEmail]=useState('');const [persona,setPersona]=useState<'alice'|'bob'|'charlie'>('alice');const [permission,setPermission]=useState<SharePermission>('view');const [error,setError]=useState('');
 const closeRef=useRef<HTMLButtonElement>(null);
 const canManage=permissions.allowedOperations.includes('manage-shares')&&session?.kind!=='guest';
 const fetchShares=useCallback(async()=>{try{setShares(await apiFetch<Share[]>(`/api/documents/${documentId}/shares`));}catch{setError('Sharing is unavailable. Please try again.');}finally{setLoading(false);}},[documentId]);
 useEffect(()=>{const previous=document.activeElement;closeRef.current?.focus();let active=true;void Promise.resolve().then(()=>{if(!active)return;if(canManage)void fetchShares();else setLoading(false);});return()=>{active=false;if(previous instanceof HTMLElement)previous.focus();};},[fetchShares,canManage]);
 const grant=async(event:React.FormEvent)=>{event.preventDefault();setSaving(true);setError('');try{
  const share=await apiFetch<Share>(`/api/documents/${documentId}/shares`,{method:'POST',body:JSON.stringify({...session?.kind==='demo'?{persona}:{email:email.trim()},permission})});setShares(previous=>[...previous.filter(s=>s.id!==share.id),share]);setEmail('');
 }catch{setError('Access could not be granted. Check the recipient and try again. Only existing verified accounts can receive shares.');}finally{setSaving(false);}};
 const revoke=async(shareId:string)=>{setSaving(true);try{await apiFetch(`/api/documents/${documentId}/shares/${shareId}`,{method:'DELETE'});setShares(previous=>previous.filter(s=>s.id!==shareId));}catch{setError('Access could not be revoked. Please try again.');}finally{setSaving(false);}};
 return <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={e=>{if(e.target===e.currentTarget)onClose();}} onKeyDown={e=>{if(e.key==='Escape')onClose();if(e.key==='Tab'){const focusable=Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input, select'));const first=focusable[0],last=focusable.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}} role="dialog" aria-modal="true" aria-label="Share document">
 <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 p-5 space-y-5"><div className="flex justify-between items-center"><h2 className="text-sm font-bold flex gap-2"><Share2 size={16}/>Share document</h2><button ref={closeRef} onClick={onClose} aria-label="Close"><X size={16}/></button></div><p className="text-sm">{documentTitle}</p><p className="text-xs text-zinc-500">Owner: {ownerName}</p>
 {!canManage?<p className="text-sm text-zinc-500">{session?.kind==='guest'?'Guest workspaces cannot share documents. Create an account to share.':'Only the document owner can manage sharing.'}</p>:<>
 {loading?<p role="status">Loading shares…</p>:<ul className="space-y-2">{shares.map(share=><li key={share.id} className="flex gap-2 items-center text-sm"><span className="flex-1">{'persona' in share.recipient?DEMO_PERSONAS.find(p=>p.persona===share.recipient.persona)?.name:share.recipient.userId}</span><span>{share.permission}</span><Button variant="ghost" size="xs" aria-label="Revoke access" icon={<Trash2 size={13}/>} disabled={saving} onClick={()=>void revoke(share.id)}/></li>)}</ul>}
 <form onSubmit={grant} className="space-y-3 border-t border-zinc-200 pt-4">{session?.kind==='demo'?<label className="block text-sm">Demo recipient<select aria-label="Demo recipient" value={persona} onChange={event=>{const value=DEMO_PERSONAS.find(p=>p.persona===event.target.value)?.persona;if(value)setPersona(value);}} className="block w-full p-2 border rounded-lg bg-transparent">{DEMO_PERSONAS.map(p=><option key={p.persona} value={p.persona}>{p.label}</option>)}</select></label>:<label className="block text-sm">Exact email address<input type="email" value={email} required maxLength={254} onChange={e=>setEmail(e.target.value)} className="block w-full p-2 border rounded-lg bg-transparent"/></label>}
 <label className="block text-sm">Permission<select aria-label="Permission" value={permission} onChange={e=>setPermission(e.target.value==='edit'?'edit':'view')} className="block w-full p-2 border rounded-lg bg-transparent"><option value="view">Can view</option><option value="edit">Can edit</option></select></label><Button type="submit" loading={saving}>Grant access</Button></form></>}
 {error&&<p role="alert" className="text-sm text-red-600">{error}</p>}</div></div>;
}
