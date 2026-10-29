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
