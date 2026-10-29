// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SessionProvider, useSession } from '../../components/auth/SessionProvider';
import PublicEntry from '../../components/auth/PublicEntry';
import { ToastProvider } from '../../components/atoms/ToastProvider';
import DocumentPage from '../../app/documents/[id]/page';
import { clearSessionSnapshot } from '../../lib/http/client';
vi.mock('../../app/auth/actions',()=>({ getAuthCsrfToken:vi.fn(async()=>({ok:true,csrfToken:'auth-csrf'})),signInWithGoogle:vi.fn(),signOut:vi.fn(),signInWithPassword:vi.fn(),signUp:vi.fn(),resendVerification:vi.fn(),requestPasswordReset:vi.fn(),updatePassword:vi.fn() }));
let root:Root;let container:HTMLDivElement;
const now='2026-10-27T00:00:00Z';
const guest={kind:'guest',workspaceId:'w',sessionId:'s',generation:3,expiresAt:'2026-10-27T05:00:00Z'};
const user={kind:'user',userId:'u',displayName:'Same name',email:'reader@example.test'};
const doc={id:'doc',title:'Guest draft',content:'<p>Private guest content</p>',owner:'Same name',history:[],shares:[],attachments:[],permissions:{role:'owner',allowedOperations:['read','edit','upload','restore','delete']}};
beforeEach(()=>{vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);container=document.createElement('div');document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();clearSessionSnapshot();vi.unstubAllGlobals();});
async function render(element:React.ReactNode){await act(async()=>{root.render(React.createElement(ToastProvider,null,React.createElement(SessionProvider,null,element)));});}
function SessionEntry(){const {status,snapshot}=useSession();return status==='ready'&&!snapshot?.session?React.createElement(PublicEntry):null;}
it('public entry starts a demo through bound CSRF without sending any browser owner identity',async()=>{
 let request:RequestInit|undefined;
 vi.stubGlobal('fetch',async(path:string,init:RequestInit)=>{if(init?.method==='POST'){request=init;return Response.json({session:{...guest,kind:'demo',persona:'alice'},csrfToken:'demo-csrf',serverNow:now});}return Response.json({session:null,csrfToken:'entry-csrf',serverNow:now});});
 await render(React.createElement(SessionEntry));
 const button=Array.from(container.querySelectorAll('button')).find(button=>button.textContent==='Try Alice demo');expect(button).toBeTruthy();
 await act(async()=>button!.click());
 expect(JSON.parse(String(request?.body))).toEqual({kind:'demo',persona:'alice'});expect(new Headers(request?.headers).get('X-CSRF-Token')).toBe('entry-csrf');
});
it('focus expiry unmounts private HTML and cancels a pending editor save',async()=>{
 let expired=false;let writes=0;
 vi.stubGlobal('fetch',async(path:string,init:RequestInit)=>{
  if(path==='/api/session')return Response.json({session:expired?null:guest,csrfToken:'csrf',serverNow:now,...(expired?{code:'SESSION_EXPIRED',error:'Expired'}:{})},{status:expired?410:200});
  if(init?.method==='PATCH')writes++;
  return Response.json(doc);
 });
 const params=Promise.resolve({id:'doc'});await render(React.createElement(DocumentPage,{params}));
 expect(container.textContent).toContain('Private guest content');
 const editor=container.querySelector('[contenteditable="true"]');expect(editor).toBeTruthy();
 await act(async()=>{editor!.innerHTML='<p>Unsaved secret</p>';editor!.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Unsaved secret'}));});
 expired=true;await act(async()=>window.dispatchEvent(new Event('focus')));
 expect(container.textContent).not.toContain('Private guest content');expect(container.textContent).not.toContain('Unsaved secret');expect(container.textContent).toContain('Your guest session has expired.');
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1300));});expect(writes).toBe(0);
});
it('server viewer DTO overrides a matching owner display name',async()=>{
 vi.stubGlobal('fetch',async(path:string)=>Response.json(path==='/api/session'?{session:user,csrfToken:'csrf',serverNow:now}:{...doc,permissions:{role:'viewer',allowedOperations:['read']}}));
 const params=Promise.resolve({id:'doc'});await render(React.createElement(DocumentPage,{params}));
 expect(container.textContent).toContain('Private guest content');expect(container.querySelector('[contenteditable="true"]')).toBeNull();
 const buttons=Array.from(container.querySelectorAll('button')).map(button=>button.textContent);
 expect(buttons).not.toContain('Import');expect(buttons).not.toContain('Share');expect(container.querySelector('input')?.readOnly).toBe(true);
});
it('missing documents show dashboard recovery without stale content',async()=>{
 vi.stubGlobal('fetch',async(path:string)=>Response.json(path==='/api/session'?{session:user,csrfToken:'csrf',serverNow:now}:{error:'Document not found.',code:'NOT_FOUND'},{status:path==='/api/session'?200:404}));
 const params=Promise.resolve({id:'missing'});await render(React.createElement(DocumentPage,{params}));
 expect(container.textContent).toContain('Document not found');expect(container.querySelector('a[href="/"]')?.textContent).toContain('Back to my documents');expect(container.querySelector('[contenteditable]')).toBeNull();
});

it('marks edits as pending immediately before the autosave debounce',async()=>{
 vi.stubGlobal('fetch',async(path:string)=>Response.json(path==='/api/session'?{session:guest,csrfToken:'csrf',serverNow:now}:doc));
 const params=Promise.resolve({id:'doc'});await render(React.createElement(DocumentPage,{params}));
 const editor=container.querySelector('[contenteditable="true"]')!;
 await act(async()=>{editor.innerHTML='<p>Changed</p>';editor.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:'Changed'}));});
 expect(container.textContent).toContain('Saving…');
 expect(container.textContent).not.toContain('Saved');
});

it('preserves a pending draft through focus when the authoritative session is unchanged',async()=>{
 let writes=0;
 vi.stubGlobal('fetch',async(path:string,init?:RequestInit)=>{if(path==='/api/session')return Response.json({session:guest,csrfToken:'csrf',serverNow:now});if(init?.method==='PATCH')writes++;return Response.json(doc);});
 await render(React.createElement(DocumentPage,{params:Promise.resolve({id:'doc'})}));const editor=container.querySelector('[contenteditable=true]')!;
 await act(async()=>{editor.innerHTML='<p>Pending focus draft</p>';editor.dispatchEvent(new InputEvent('input',{bubbles:true}));});
 await act(async()=>window.dispatchEvent(new Event('focus')));expect(container.textContent).toContain('Pending focus draft');
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1300));});expect(writes).toBe(1);expect(container.textContent).toContain('Pending focus draft');
});

vi.mock('server-only',()=>({}));
import {issueCsrf,verifyCsrf} from '../../lib/security/csrf';
it('keeps a draft and saves after sixteen minutes using refreshed real CSRF',async()=>{
 vi.stubEnv('CSRF_SECRET','c'.repeat(64));const binding='temporary:review';let gets=0,writes=0;
 vi.stubGlobal('fetch',async(path:string,init?:RequestInit)=>{
  if(path==='/api/session'){gets++;return Response.json({session:guest,csrfToken:issueCsrf(binding),serverNow:now});}
  if(init?.method==='PATCH'){writes++;if(!verifyCsrf(binding,new Headers(init.headers).get('x-csrf-token')??''))return Response.json({code:'FORBIDDEN',error:'A valid CSRF token is required.',refreshCsrf:true},{status:403});}
  return Response.json(doc);
 });
 await render(React.createElement(DocumentPage,{params:Promise.resolve({id:'doc'})}));const clock=vi.spyOn(Date,'now').mockReturnValue(Date.now()+16*60*1000);
 try{const editor=container.querySelector('[contenteditable=true]')!;await act(async()=>{editor.innerHTML='<p>Draft after sixteen minutes</p>';editor.dispatchEvent(new InputEvent('input',{bubbles:true}));});await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1400));});expect(gets).toBe(2);expect(writes).toBe(2);expect(container.textContent).toContain('Draft after sixteen minutes');expect(container.textContent).not.toContain('Document not found');}finally{clock.mockRestore();vi.unstubAllEnvs();}
});

import VersionHistory from '../../components/VersionHistory';
it('allows restoring a seeded old revision even when it is the newest stored revision',async()=>{
 const version={id:'old',title:'Old title',content:'<p>Old draft</p>',updatedAt:now,updatedBy:'Alice'};
 await act(async()=>root.render(React.createElement(VersionHistory,{history:[version],onRestore:()=>{},canRestore:true,currentContent:'<p>Current draft</p>',currentTitle:'Current title'})));
 expect(Array.from(container.querySelectorAll('button')).some(button=>button.textContent?.includes('Restore'))).toBe(true);
});

import {sessionKey} from '../../lib/http/client';
it('does not replace a dirty local draft when another tab announces a save',async()=>{
 let writes=0;vi.stubGlobal('fetch',async(path:string,init?:RequestInit)=>{if(path==='/api/session')return Response.json({session:guest,csrfToken:'csrf',serverNow:now});if(init?.method==='PATCH')writes++;return Response.json(doc);});
 await render(React.createElement(DocumentPage,{params:Promise.resolve({id:'doc'})}));const editor=container.querySelector('[contenteditable=true]')!;
 await act(async()=>{editor.innerHTML='<p>Draft while another tab saves</p>';editor.dispatchEvent(new InputEvent('input',{bubbles:true}));});
 const channel=new BroadcastChannel(`doc-sync-${sessionKey(guest as never)}-doc`);
 try{await act(async()=>{channel.postMessage({type:'document-changed',source:'other-tab'});await new Promise(resolve=>setTimeout(resolve,250));});expect(container.textContent).toContain('Draft while another tab saves');await act(async()=>{await new Promise(resolve=>setTimeout(resolve,1100));});expect(writes).toBe(1);}finally{channel.close();}
});

it('serializes autosaves so an older slow request cannot overwrite a newer edit',async()=>{
 let release!:(value:Response)=>void;const contents:string[]=[];
 vi.stubGlobal('fetch',async(path:string,init?:RequestInit)=>{
  if(path==='/api/session')return Response.json({session:guest,csrfToken:'csrf',serverNow:now});
  if(init?.method==='PATCH'){contents.push(JSON.parse(String(init.body)).content);if(contents.length===1)return new Promise<Response>(resolve=>{release=resolve;});}
  return Response.json(doc);
 });
 await render(React.createElement(DocumentPage,{params:Promise.resolve({id:'doc'})}));const editor=container.querySelector('[contenteditable=true]')!;
 const edit=async(text:string)=>act(async()=>{editor.innerHTML=`<p>${text}</p>`;editor.dispatchEvent(new InputEvent('input',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,1300));});
 await edit('First');await edit('Second');expect(contents).toHaveLength(1);
 await act(async()=>{release(Response.json(doc));await new Promise(resolve=>setTimeout(resolve,20));});expect(contents).toEqual(['<p>First</p>','<p>Second</p>']);expect(container.textContent).toContain('Second');expect(container.textContent).toContain('Saved');
});

it('keeps the in-memory draft when a background session recheck has a network failure',async()=>{
 let offline=false;vi.stubGlobal('fetch',async(path:string)=>{if(path==='/api/session'){if(offline)throw new Error('Network unavailable');return Response.json({session:guest,csrfToken:'csrf',serverNow:now});}return Response.json(doc);});
 await render(React.createElement(DocumentPage,{params:Promise.resolve({id:'doc'})}));const editor=container.querySelector('[contenteditable=true]')!;await act(async()=>{editor.innerHTML='<p>Draft during network failure</p>';editor.dispatchEvent(new InputEvent('input',{bubbles:true}));});offline=true;await act(async()=>window.dispatchEvent(new Event('focus')));expect(container.textContent).toContain('Draft during network failure');expect(container.textContent).toContain('Network unavailable');
});
