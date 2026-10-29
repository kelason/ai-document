"use client";
import React, { use, useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, Share2, FileText, Clock, AlignLeft, History, Check, Upload, Lock } from "lucide-react";
import Editor from "@/components/Editor";
import Outline from "@/components/Outline";
import VersionHistory from "@/components/VersionHistory";
import ShareModal from "@/components/molecules/ShareModal";
import FileUploadDropzone from "@/components/molecules/FileUploadDropzone";
import Avatar from "@/components/atoms/Avatar";
import Spinner from "@/components/atoms/Spinner";
import Badge from "@/components/atoms/Badge";
import Button from "@/components/atoms/Button";
import { useToast } from "@/components/atoms/ToastProvider";
import { CONTENT_SAVE_DEBOUNCE_MS, TITLE_SAVE_DEBOUNCE_MS, PRESENCE_HEARTBEAT_MS, DEMO_PERSONAS } from "@/lib/constants";
import { apiFetch, ClientApiError, sessionKey } from '@/lib/http/client';
import type { DocumentDetail, DocumentPermissions, DocumentVersion, Presence } from '@/lib/documents/types';
import { useSession, SessionStatus } from '@/components/auth/SessionProvider';
import AccountMenu from '@/components/auth/AccountMenu';
import PublicEntry from '@/components/auth/PublicEntry';
import SessionBanner from '@/components/temporary/SessionBanner';
interface PageProps {params:Promise<{id:string}>}
const READING_WPM=200;
export default function DocumentWorkspace({params}:PageProps){
 const {id}=use(params);const {snapshot,status}=useSession();
 return <><SessionStatus/>{status==='ready'&&(snapshot?.session?<Workspace key={`${sessionKey(snapshot.session)}:${id}`} id={id}/>:<PublicEntry/>)}</>;
}
function Workspace({id}:{id:string}){
 const {snapshot}=useSession();const session=snapshot!.session!;const scope=sessionKey(session);
 const profile=session.kind==='demo'?DEMO_PERSONAS.find(p=>p.persona===session.persona):undefined;
 const activeUser={id:session.kind==='user'?session.userId:session.kind==='demo'?session.persona:session.sessionId,name:session.kind==='user'?session.displayName:profile?.name??'Guest',avatar:profile?.avatar??(session.kind==='user'?session.displayName.slice(0,2).toUpperCase():'G'),color:profile?.color??'#6366f1'};
 const {addToast}=useToast();
 const [docTitle,setDocTitle]=useState('Loading…');const [docContent,setDocContent]=useState('');const [contentRevision,setContentRevision]=useState(0);
 const [docHistory,setDocHistory]=useState<DocumentVersion[]>([]);const [owner,setOwner]=useState('');
 const [permissions,setPermissions]=useState<DocumentPermissions>({role:'viewer',allowedOperations:[]});
 const canEdit=permissions.allowedOperations.includes('edit');
 const [saveStatus,setSaveStatus]=useState<'saved'|'saving'|'offline'>('saved');
 const [showOutline,setShowOutline]=useState(true);const [showHistory,setShowHistory]=useState(false);
 const [showShareModal,setShowShareModal]=useState(false);const [showUploadModal,setShowUploadModal]=useState(false);
 const [isLoading,setIsLoading]=useState(true);const [loadError,setLoadError]=useState<'not-found'|'unavailable'|null>(null);
 const [remoteUsers,setRemoteUsers]=useState<Presence[]>([]);const [localCursor,setLocalCursor]=useState<{x:number;y:number}|null>(null);
 const contentSaveTimeout=useRef<ReturnType<typeof setTimeout>|null>(null);const titleSaveTimeout=useRef<ReturnType<typeof setTimeout>|null>(null);
 const lifetime=useRef<AbortController|null>(null);const fetchSequence=useRef(0);
 const cancelPending=useCallback(()=>{if(contentSaveTimeout.current)clearTimeout(contentSaveTimeout.current);if(titleSaveTimeout.current)clearTimeout(titleSaveTimeout.current);},[]);
 const applyDocument=useCallback((doc:DocumentDetail)=>{setDocTitle(doc.title);setDocContent(doc.content);setDocHistory(doc.history);setOwner(doc.owner);setPermissions(doc.permissions);setContentRevision(r=>r+1);},[]);
 const fetchDoc=useCallback(async()=>{
  cancelPending();const request=++fetchSequence.current;const signal=lifetime.current?.signal;setIsLoading(true);setLoadError(null);
  try{const doc=await apiFetch<DocumentDetail>(`/api/documents/${id}`,{signal});if(request!==fetchSequence.current||signal?.aborted)return;applyDocument(doc);}
  catch(error){if(signal?.aborted||request!==fetchSequence.current)return;setDocContent('');setDocHistory([]);setRemoteUsers([]);setLoadError(error instanceof ClientApiError&&[403,404].includes(error.status)?'not-found':'unavailable');}
  finally{if(!signal?.aborted&&request===fetchSequence.current)setIsLoading(false);}
 },[id,applyDocument,cancelPending]);
 useEffect(()=>{const controller=new AbortController();lifetime.current=controller;void Promise.resolve().then(()=>{if(!controller.signal.aborted)void fetchDoc();});return()=>{controller.abort();cancelPending();};},[fetchDoc,cancelPending]);
 const notifySaved=()=>{if(typeof BroadcastChannel!=='undefined'){const channel=new BroadcastChannel(`doc-sync-${scope}-${id}`);channel.postMessage({type:'document-changed'});channel.close();}};
 const save=async(input:{title?:string;content?:string})=>{
  if(!canEdit||lifetime.current?.signal.aborted)return;setSaveStatus('saving');
  try{const doc=await apiFetch<DocumentDetail>(`/api/documents/${id}`,{method:'PATCH',body:JSON.stringify(input),signal:lifetime.current?.signal});if(lifetime.current?.signal.aborted)return;setDocHistory(doc.history);setPermissions(doc.permissions);setSaveStatus('saved');notifySaved();}
  catch(error){if(lifetime.current?.signal.aborted)return;if(error instanceof ClientApiError&&[403,404].includes(error.status)){cancelPending();setDocContent('');setDocHistory([]);setRemoteUsers([]);setLoadError('not-found');}setSaveStatus('offline');addToast('error',error instanceof Error?error.message:'Document could not be saved.');}
 };
 const handleTitleChange=(event:React.ChangeEvent<HTMLInputElement>)=>{if(!canEdit)return;const title=event.target.value;setDocTitle(title);if(titleSaveTimeout.current)clearTimeout(titleSaveTimeout.current);titleSaveTimeout.current=setTimeout(()=>void save({title}),TITLE_SAVE_DEBOUNCE_MS);};
 const handleContentChange=(content:string)=>{if(!canEdit)return;setDocContent(content);if(contentSaveTimeout.current)clearTimeout(contentSaveTimeout.current);contentSaveTimeout.current=setTimeout(()=>void save({content}),CONTENT_SAVE_DEBOUNCE_MS);};
 const handleFileImported=(html:string)=>{if(!permissions.allowedOperations.includes('upload'))return;cancelPending();const content=docContent+html;setDocContent(content);setContentRevision(r=>r+1);void save({content});};
 const handleRestoreVersion=async(versionId:string)=>{
  if(!permissions.allowedOperations.includes('restore'))return;cancelPending();setSaveStatus('saving');
  try{const doc=await apiFetch<DocumentDetail>(`/api/documents/${id}`,{method:'PATCH',body:JSON.stringify({restoreVersionId:versionId}),signal:lifetime.current?.signal});if(lifetime.current?.signal.aborted)return;applyDocument(doc);setSaveStatus('saved');notifySaved();}
  catch(error){if(lifetime.current?.signal.aborted)return;if(error instanceof ClientApiError&&[403,404].includes(error.status)){cancelPending();setDocContent('');setDocHistory([]);setRemoteUsers([]);setLoadError('not-found');}setSaveStatus('offline');addToast('error',error instanceof Error?error.message:'Restore failed.');}
 };
 useEffect(()=>{
  if(isLoading||loadError||!permissions.allowedOperations.includes('presence'))return;
  const timer=setInterval(async()=>{try{const data=await apiFetch<Presence[]|{activeUsers:Presence[]}>(`/api/documents/${id}/presence`,{method:'POST',body:JSON.stringify({active:true,...(localCursor?{cursorOffset:localCursor.x,cursorY:localCursor.y}:{})}),signal:lifetime.current?.signal});if(!lifetime.current?.signal.aborted)setRemoteUsers(Array.isArray(data)?data:data.activeUsers);}catch{/* Best effort; session failures are handled by the shared client. */}},PRESENCE_HEARTBEAT_MS);
  return()=>clearInterval(timer);
 },[id,isLoading,loadError,localCursor,permissions]);
  // ── Word stats ─────────────────────────────────────────────────────────────
  const getDocStats = () => {
    if (typeof window === "undefined" || !docContent) return { words: 0, chars: 0, time: 0 };
    const text    = docContent.replace(/<[^>]*>/g, " ");
    const trimmed = text.trim();
    const words   = trimmed ? trimmed.split(/\s+/).length : 0;
    return { words, chars: text.length, time: Math.ceil(words / READING_WPM) };
  };
  const stats = getDocStats();

  if (loadError) {
    const notFound = loadError === "not-found";
    return (
      <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
        <div className="max-w-md text-center space-y-6">
          <FileText size={48} className="mx-auto text-zinc-400" />
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {notFound ? "Document not found" : "Could not load document"}
          </h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {notFound
              ? "This document is no longer available, or the link is incorrect. Open the dashboard to choose or create a document."
              : "The document could not be loaded. Check your connection and try again."}
          </p>
          <div className="flex items-center justify-center gap-4">
            <Link href="/" className="text-sm font-semibold text-indigo-600 dark:text-indigo-400">
              Back to my documents
            </Link>
            {!notFound && <Button onClick={() => void fetchDoc()}>Try again</Button>}
          </div>
        </div>
      </main>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 w-full min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">

      {/* Top Bar */}
      <header className="sticky top-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur border-b border-zinc-200 dark:border-zinc-800/80 z-30 select-none">
        <div className="max-w-full mx-auto px-4 h-16 flex items-center justify-between gap-3">

          {/* Left: nav + title */}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Link href="/"
              className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors shrink-0">
              <ChevronLeft size={20} />
            </Link>

            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-xl shrink-0">
              <FileText size={20} />
            </div>

            <div className="flex flex-col min-w-0 pr-4">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={docTitle}
                  onChange={handleTitleChange}
                  readOnly={!canEdit}
                  aria-label="Document title"
                  placeholder="Untitled Document"
                  className="text-sm font-bold text-zinc-900 dark:text-zinc-50 bg-transparent border-b border-transparent hover:border-zinc-300 dark:hover:border-zinc-700 focus:border-indigo-500 focus:outline-none transition-colors w-full px-0.5 truncate read-only:cursor-default read-only:hover:border-transparent"
                />
                {!canEdit && (
                  <Badge variant="view"><Lock size={8} /> View only</Badge>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                <span className="text-[10px] text-zinc-400">By {owner}</span>
                <span className="text-zinc-300 dark:text-zinc-700">•</span>
                {saveStatus === "saving" && (
                  <span className="text-[10px] text-indigo-600 dark:text-indigo-400 font-semibold animate-pulse">Saving…</span>
                )}
                {saveStatus === "saved" && (
                  <span className="text-[10px] text-emerald-600 dark:text-emerald-500 font-semibold flex items-center gap-0.5">
                    <Check size={10} /> Saved
                  </span>
                )}
                {saveStatus === "offline" && (
                  <span className="text-[10px] text-red-500 font-semibold">Offline / error</span>
                )}
              </div>
            </div>
          </div>

          {/* Right: presence + actions */}
          <div className="flex items-center gap-3 shrink-0">

            {/* Remote presence avatars */}
            {remoteUsers.length > 0 && (
              <div className="flex -space-x-2.5">
                {remoteUsers.map((u) => (
                  <Avatar key={u.userId} initials={u.avatar} color={u.color} size="sm" title={u.name} />
                ))}
              </div>
            )}

            <AccountMenu/>

            {/* Import file button */}
            {permissions.allowedOperations.includes("upload") && (
              <Button variant="secondary" size="sm" icon={<Upload size={13} />}
                onClick={() => setShowUploadModal(true)}>
                Import
              </Button>
            )}

            {/* Share button */}
            {permissions.allowedOperations.includes('manage-shares') && <Button variant="primary" size="sm" icon={<Share2 size={13} />}
              onClick={() => setShowShareModal(true)}>
              Share
            </Button>}
          </div>
        </div>
      </header>

      <SessionBanner/>
      {/* Workspace body */}
      <div className="flex-1 flex overflow-hidden w-full h-[calc(100vh-4rem)]">

        {/* Side icon bar */}
        <div className="w-12 bg-white dark:bg-zinc-900 border-r border-zinc-200 dark:border-zinc-800/80 flex flex-col items-center py-4 gap-4 select-none shrink-0">
          <button onClick={() => { setShowOutline((v) => !v); if (!showOutline) setShowHistory(false); }}
            title="Document Outline"
            className={`p-2 rounded-xl transition-all ${showOutline ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}>
            <AlignLeft size={20} />
          </button>
          <button onClick={() => { setShowHistory((v) => !v); if (!showHistory) setShowOutline(false); }}
            title="Version History"
            className={`p-2 rounded-xl transition-all ${showHistory ? "bg-indigo-50 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400" : "text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"}`}>
            <History size={20} />
          </button>
        </div>

        {/* Side panels */}
        {showOutline && (
          <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800/80 shrink-0 h-full p-4 overflow-y-auto hidden md:block">
            <Outline content={docContent} />
          </aside>
        )}
        {showHistory && (
          <aside className="w-64 border-r border-zinc-200 dark:border-zinc-800/80 shrink-0 h-full p-4 overflow-y-auto hidden md:block">
            <VersionHistory history={docHistory} onRestore={handleRestoreVersion} canRestore={permissions.allowedOperations.includes("restore")} />
          </aside>
        )}

        {/* Editor area */}
        <main className="flex-1 flex flex-col h-full relative overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 md:p-6 flex flex-col justify-between">

            {/* Read-only notice */}
            {!canEdit && !isLoading && (
              <div className="mb-4 flex items-center gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-xl text-xs text-amber-800 dark:text-amber-300">
                <Lock size={13} />
                <span>
                  You have <strong>view-only</strong> access to this document. Ask the owner to grant edit access.
                </span>
              </div>
            )}

            {isLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <Spinner size="lg" />
              </div>
            ) : (
              <Editor
                documentId={id}
                syncScope={scope}
                onRemoteChange={fetchDoc}
                initialContent={docContent}
                contentRevision={contentRevision}
                activeUser={activeUser}
                onContentChange={canEdit ? handleContentChange : () => {}}
                remoteUsers={remoteUsers}
                onCursorChange={setLocalCursor}
                isSimulating={false}
                readOnly={!canEdit}
              />
            )}

            {/* Doc stats footer */}
            <div className="flex flex-wrap items-center justify-between gap-4 mt-4 px-3 py-2 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 rounded-xl text-[11px] text-zinc-400 font-medium select-none">
              <div className="flex items-center gap-3">
                <span>Words: <b className="text-zinc-700 dark:text-zinc-300">{stats.words}</b></span>
                <span className="text-zinc-200 dark:text-zinc-800">|</span>
                <span>Chars: <b className="text-zinc-700 dark:text-zinc-300">{stats.chars}</b></span>
                <span className="text-zinc-200 dark:text-zinc-800">|</span>
                <span className="flex items-center gap-0.5">
                  <Clock size={11} />
                  <span>Read: <b className="text-zinc-700 dark:text-zinc-300">{stats.time} min{stats.time !== 1 ? "s" : ""}</b></span>
                </span>
              </div>
              <span className="text-[10px] uppercase tracking-wider font-bold">Next.js Workspace</span>
            </div>
          </div>
        </main>
      </div>

      {/* Share modal */}
      {showShareModal && (
        <ShareModal
          documentId={id}
          documentTitle={docTitle}
          ownerName={owner}
          permissions={permissions}
          onClose={() => { setShowShareModal(false); fetchDoc(); }}
        />
      )}

      {/* File upload modal */}
      {showUploadModal && (
        <FileUploadDropzone
          documentId={id}
          onUploaded={handleFileImported}
          onClose={() => setShowUploadModal(false)}
        />
      )}
    </div>
  );
}
