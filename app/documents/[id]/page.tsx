"use client";

// app/documents/[id]/page.tsx
// ────────────────────────────
// Document workspace: rich text editing, presence, version history, sharing,
// and file import. Applies read-only mode for users with "view" permission.

import React, { use, useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import {
  ChevronLeft, Share2, FileText, Clock, Sparkles,
  AlignLeft, History, Check, ChevronDown, Upload, Lock, ShieldOff,
} from "lucide-react";
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
import {
  USER_PROFILES,
  CONTENT_SAVE_DEBOUNCE_MS,
  TITLE_SAVE_DEBOUNCE_MS,
  PRESENCE_HEARTBEAT_MS,
  SIM_TYPING_INTERVAL_MS,
} from "@/lib/constants";

// ── Types ─────────────────────────────────────────────────────────────────────
interface PageProps { params: Promise<{ id: string }> }

interface ActiveUser {
  userId: string; name: string; avatar: string; color: string;
  cursorOffset?: number; cursorY?: number;
}

interface Share { id: string; userId: string; permission: "view" | "edit" }

// ── Bob's simulated typing message (constant — not a magic string) ─────────
const BOB_TYPING_MESSAGE =
  " Hello! I am Bob, your AI co-editor. I am typing live on this document to showcase multi-user real-time collaboration. Notice how my cursor moves dynamically across the page while we write together!";

// ── Cursor position math constants ────────────────────────────────────────────
const CURSOR_X_BASE      = 180;
const CURSOR_X_STEP      = 4.5;
const CURSOR_X_WRAP      = 360;
const CURSOR_Y_BASE      = 360;
const CURSOR_Y_LINE_H    = 24;
const READING_WPM        = 200; // average words per minute

// ── Component ─────────────────────────────────────────────────────────────────
export default function DocumentWorkspace({ params }: PageProps) {
  const { id } = use(params);
  const { addToast } = useToast();

  // Document state
  const [docTitle,   setDocTitle]   = useState("Loading…");
  const [docContent, setDocContent] = useState("");
  const [contentRevision, setContentRevision] = useState(0);
  const [docHistory, setDocHistory] = useState<any[]>([]);
  const [docShares,  setDocShares]  = useState<Share[]>([]);
  const [owner,      setOwner]      = useState("System");

  // Read the active user index from localStorage synchronously on first render
  // so the correct user is active from the start — no async race condition.
  const [activeUserIndex, setActiveUserIndex] = useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("active_user_index");
      if (saved !== null) return parseInt(saved, 10);
    }
    return 0;
  });

  const [saveStatus,         setSaveStatus]         = useState<"saved" | "saving" | "offline">("saved");
  const [showOutline,        setShowOutline]        = useState(true);
  const [showHistory,        setShowHistory]        = useState(false);
  const [isSimulating,       setIsSimulating]       = useState(false);
  const [isUserDropdownOpen, setIsUserDropdownOpen] = useState(false);
  const [showShareModal,     setShowShareModal]     = useState(false);
  const [showUploadModal,    setShowUploadModal]    = useState(false);
  const [isLoading,          setIsLoading]          = useState(true);

  // Collaboration
  const [remoteUsers, setRemoteUsers] = useState<ActiveUser[]>([]);
  const [localCursor, setLocalCursor] = useState<{ x: number; y: number } | null>(null);

  // Debounce refs
  const contentSaveTimeout  = useRef<NodeJS.Timeout | null>(null);
  const titleSaveTimeout    = useRef<NodeJS.Timeout | null>(null);
  const simulationInterval  = useRef<NodeJS.Timeout | null>(null);

  const activeUser = USER_PROFILES[activeUserIndex];

  // ── Permission checks ───────────────────────────────────────────────────────
  // hasAccess: true when the user is the owner OR has any share record
  // canEdit:   true when the user is the owner OR has an "edit" share
  const isOwner   = activeUser.name === owner;
  const myShare   = docShares.find((s) => s.userId === activeUser.id);
  const hasAccess = isOwner || !!myShare;
  const canEdit   = isOwner || myShare?.permission === "edit";

  // ── Persist active user whenever it changes ──────────────────────────────
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("active_user_index", activeUserIndex.toString());
    }
  }, [activeUserIndex]);

  // ── Fetch document ─────────────────────────────────────────────────────────
  const fetchDoc = useCallback(async () => {
    try {
      const res = await fetch(`/api/documents/${id}`);
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Unknown" }));
        addToast("error", `Document load failed: ${error}`);
        setDocTitle("Document Not Found");
        return;
      }
      const doc = await res.json();
      setDocTitle(doc.title);
      setDocContent(doc.content);
      setDocHistory(doc.history ?? []);
      setDocShares(doc.shares ?? []);
      setOwner(doc.owner);
    } catch {
      addToast("error", "Network error — could not load document.");
    } finally {
      setIsLoading(false);
    }
  }, [id, addToast]);

  useEffect(() => { fetchDoc(); }, [fetchDoc]);

  // ── Persist active user ────────────────────────────────────────────────────
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("active_user_index", activeUserIndex.toString());
    }
  }, [activeUserIndex]);

  // ── Save title ─────────────────────────────────────────────────────────────
  const saveTitleToDb = async (newTitle: string) => {
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTitle, updatedBy: activeUser.name }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Server error" }));
        addToast("error", `Title save failed: ${error}`);
        setSaveStatus("offline");
        return;
      }
      const doc = await res.json();
      setDocHistory(doc.history ?? []);
      setSaveStatus("saved");
    } catch {
      addToast("error", "Network error — title not saved.");
      setSaveStatus("offline");
    }
  };

  // ── Save content ───────────────────────────────────────────────────────────
  const saveContentToDb = async (newContent: string) => {
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: newContent, updatedBy: activeUser.name }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Server error" }));
        addToast("error", `Content save failed: ${error}`);
        setSaveStatus("offline");
        return;
      }
      const doc = await res.json();
      setDocHistory(doc.history ?? []);
      setSaveStatus("saved");
    } catch {
      addToast("error", "Network error — content not saved.");
      setSaveStatus("offline");
    }
  };

  // ── Title input change ─────────────────────────────────────────────────────
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) return;
    const newTitle = e.target.value;
    setDocTitle(newTitle);
    if (titleSaveTimeout.current) clearTimeout(titleSaveTimeout.current);
    titleSaveTimeout.current = setTimeout(() => saveTitleToDb(newTitle), TITLE_SAVE_DEBOUNCE_MS);
  };

  // ── Content change ─────────────────────────────────────────────────────────
  const handleContentChange = (newContent: string) => {
    setDocContent(newContent);
    if (contentSaveTimeout.current) clearTimeout(contentSaveTimeout.current);
    contentSaveTimeout.current = setTimeout(() => saveContentToDb(newContent), CONTENT_SAVE_DEBOUNCE_MS);

    const channel = new BroadcastChannel(`doc-sync-${id}`);
    channel.postMessage({ type: "content-update", content: newContent, sender: activeUser.id });
    channel.close();
  };

  // ── File import callback ───────────────────────────────────────────────────
  const handleFileImported = (parsedHtml: string) => {
    const merged = docContent + parsedHtml;
    setDocContent(merged);
    setContentRevision((r) => r + 1); // Force Editor to re-sync HTML
    saveContentToDb(merged);
  };

  // ── Presence heartbeat ─────────────────────────────────────────────────────
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/documents/${id}/presence`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: activeUser.id, name: activeUser.name,
            avatar: activeUser.avatar, color: activeUser.color,
            cursorOffset: localCursor?.x, cursorY: localCursor?.y,
            active: true,
          }),
        });
        if (res.ok) {
          const data = await res.json();
          setRemoteUsers(
            (data.activeUsers ?? []).filter(
              (u: ActiveUser) => !(isSimulating && u.userId === "sim-bob")
            )
          );
        }
      } catch { /* silent — presence is best-effort */ }
    }, PRESENCE_HEARTBEAT_MS);
    return () => clearInterval(interval);
  }, [id, activeUser, localCursor, isSimulating]);

  // Cleanup presence on unmount
  useEffect(() => {
    return () => {
      fetch(`/api/documents/${id}/presence`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: activeUser.id, active: false }),
      }).catch(() => {});
    };
  }, [id, activeUser]);

  // ── Version restore ────────────────────────────────────────────────────────
  const handleRestoreVersion = async (versionId: string) => {
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/documents/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ restoreVersionId: versionId, updatedBy: activeUser.name }),
      });
      if (!res.ok) {
        addToast("error", "Version restore failed.");
        setSaveStatus("offline");
        return;
      }
      const doc = await res.json();
      setDocContent(doc.content);
      setContentRevision((r) => r + 1); // Force Editor to re-sync HTML
      setDocTitle(doc.title);
      setDocHistory(doc.history ?? []);
      setSaveStatus("saved");
      addToast("success", "Version restored!");
      const channel = new BroadcastChannel(`doc-sync-${id}`);
      channel.postMessage({ type: "content-update", content: doc.content, sender: activeUser.id });
      channel.close();
    } catch {
      addToast("error", "Network error — version not restored.");
      setSaveStatus("offline");
    }
  };

  // ── Copy share link ────────────────────────────────────────────────────────
  const handleCopyLink = () => {
    if (typeof window !== "undefined") {
      navigator.clipboard.writeText(window.location.href);
      addToast("success", "Link copied to clipboard!");
    }
  };

  // ── Co-editor simulation ───────────────────────────────────────────────────
  useEffect(() => {
    if (isSimulating) {
      const bobUser: ActiveUser = {
        userId: "sim-bob", name: "Bob (AI Assistant)",
        avatar: "BM", color: "#f59e0b",
        cursorOffset: CURSOR_X_BASE, cursorY: CURSOR_Y_BASE,
      };
      setRemoteUsers((prev) => [...prev.filter((u) => u.userId !== "sim-bob"), bobUser]);

      let idx = 0;
      simulationInterval.current = setInterval(() => {
        if (idx < BOB_TYPING_MESSAGE.length) {
          const char = BOB_TYPING_MESSAGE[idx++];
          const xOffset = CURSOR_X_BASE + (idx * CURSOR_X_STEP) % CURSOR_X_WRAP;
          const yOffset = CURSOR_Y_BASE + Math.floor((idx * CURSOR_X_STEP) / CURSOR_X_WRAP) * CURSOR_Y_LINE_H;

          setRemoteUsers((prev) =>
            prev.map((u) => u.userId === "sim-bob" ? { ...u, cursorOffset: xOffset, cursorY: yOffset } : u)
          );
          setDocContent((prev) => {
            const next = prev + char;
            const channel = new BroadcastChannel(`doc-sync-${id}`);
            channel.postMessage({ type: "content-update", content: next, sender: "sim-bob" });
            channel.close();
            if (idx === BOB_TYPING_MESSAGE.length) saveContentToDb(next);
            return next;
          });
        } else {
          if (simulationInterval.current) clearInterval(simulationInterval.current);
          setIsSimulating(false);
        }
      }, SIM_TYPING_INTERVAL_MS);
    } else {
      if (simulationInterval.current) { clearInterval(simulationInterval.current); simulationInterval.current = null; }
      setRemoteUsers((prev) => prev.filter((u) => u.userId !== "sim-bob"));
    }
    return () => { if (simulationInterval.current) clearInterval(simulationInterval.current); };
  }, [isSimulating, id]);

  // ── Word stats ─────────────────────────────────────────────────────────────
  const getDocStats = () => {
    if (typeof window === "undefined" || !docContent) return { words: 0, chars: 0, time: 0 };
    const text    = docContent.replace(/<[^>]*>/g, " ");
    const trimmed = text.trim();
    const words   = trimmed ? trimmed.split(/\s+/).length : 0;
    return { words, chars: text.length, time: Math.ceil(words / READING_WPM) };
  };
  const stats = getDocStats();

  // ── Access Denied page ─────────────────────────────────────────────────────
  // Shown once the document has loaded but the active user has no access at all.
  // We only evaluate this after loading so we don't flash it during the fetch.
  if (!isLoading && !hasAccess && owner !== "System") {
    return (
      <div className="flex-1 w-full min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">
        {/* Minimal header */}
        <header className="sticky top-0 bg-white/90 dark:bg-zinc-900/90 backdrop-blur border-b border-zinc-200 dark:border-zinc-800/80 z-30 select-none">
          <div className="max-w-full mx-auto px-4 h-16 flex items-center gap-3">
            <Link href="/" className="p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-xl text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors">
              <ChevronLeft size={20} />
            </Link>
            <div className="p-2 bg-red-50 dark:bg-red-950/40 text-red-500 rounded-xl">
              <ShieldOff size={20} />
            </div>
            <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Access Restricted</span>
          </div>
        </header>

        {/* Access Denied body */}
        <main className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-md w-full text-center space-y-6">
            {/* Icon */}
            <div className="flex justify-center">
              <div className="p-6 bg-red-50 dark:bg-red-950/30 rounded-full border border-red-100 dark:border-red-900/50">
                <ShieldOff size={48} className="text-red-400" />
              </div>
            </div>

            {/* Message */}
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
                You don&apos;t have access
              </h2>
              <p className="text-sm text-zinc-500 dark:text-zinc-400 leading-relaxed">
                <span className="font-semibold text-zinc-700 dark:text-zinc-300">{activeUser.name}</span> does not
                have permission to view this document. Please ask the document owner to share it with you.
              </p>
            </div>

            {/* Owner info */}
            <div className="flex items-center justify-center gap-2.5 px-4 py-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-2xl">
              <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-950/40 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300 shrink-0">
                {owner.split(" ").map((n) => n[0]).join("").slice(0, 2)}
              </div>
              <div className="text-left">
                <p className="text-[10px] text-zinc-400 uppercase tracking-wider font-semibold">Document owner</p>
                <p className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{owner}</p>
              </div>
            </div>

            {/* Action */}
            <div className="flex justify-center">
              <Link
                href="/"
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold rounded-xl transition-all active:scale-95 shadow-md shadow-indigo-600/20"
              >
                <ChevronLeft size={16} />
                Back to my documents
              </Link>
            </div>
          </div>
        </main>
      </div>
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

            {/* Simulate co-editor */}
            <Button
              variant={isSimulating ? "secondary" : "ghost"}
              size="sm"
              icon={<Sparkles size={13} className={isSimulating ? "animate-spin" : ""} />}
              onClick={() => setIsSimulating((s) => !s)}
            >
              {isSimulating ? "Stop" : "Simulate Co-editor"}
            </Button>

            {/* Active user dropdown */}
            <div className="relative">
              <Button variant="ghost" size="sm"
                icon={<div className="w-2 h-2 rounded-full" style={{ backgroundColor: activeUser.color }} />}
                onClick={() => setIsUserDropdownOpen((o) => !o)}
              >
                {activeUser.name.split(" ")[0]} <ChevronDown size={12} />
              </Button>
              {isUserDropdownOpen && (
                <div className="absolute right-0 mt-1.5 w-48 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl shadow-lg z-50 py-1.5">
                  <div className="px-3 py-1.5 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider border-b border-zinc-100 dark:border-zinc-800">
                    Switch user
                  </div>
                  {USER_PROFILES.map((profile, i) => (
                    <button key={profile.id}
                      onClick={() => { setActiveUserIndex(i); setIsUserDropdownOpen(false); }}
                      className="flex items-center gap-2 w-full px-3 py-2 text-xs text-left text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800/60">
                      <Avatar initials={profile.avatar} color={profile.color} size="xs" />
                      <span>{profile.name}</span>
                      {activeUserIndex === i && <Check size={12} className="ml-auto text-indigo-600" />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Import file button */}
            {canEdit && (
              <Button variant="secondary" size="sm" icon={<Upload size={13} />}
                onClick={() => setShowUploadModal(true)}>
                Import
              </Button>
            )}

            {/* Share button */}
            <Button variant="primary" size="sm" icon={<Share2 size={13} />}
              onClick={() => setShowShareModal(true)}>
              Share
            </Button>
          </div>
        </div>
      </header>

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
            <VersionHistory history={docHistory} onRestore={handleRestoreVersion} />
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
                initialContent={docContent}
                contentRevision={contentRevision}
                activeUser={activeUser}
                onContentChange={canEdit ? handleContentChange : () => {}}
                remoteUsers={remoteUsers}
                onCursorChange={setLocalCursor}
                isSimulating={isSimulating}
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
          activeUser={activeUser}
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
