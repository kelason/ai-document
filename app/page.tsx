"use client";

// app/page.tsx
// ─────────────
// Dashboard: lists owned & shared documents, allows creation from templates,
// file search, and opening the ShareModal per-document.

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import {
  FileText, Search, Plus, Trash2, Calendar, Grid, List as ListIcon,
  Sparkles, Users, Briefcase, Laptop, Share2, Upload, Crown,
} from "lucide-react";

import Badge from "@/components/atoms/Badge";
import Avatar from "@/components/atoms/Avatar";
import Spinner from "@/components/atoms/Spinner";
import Button from "@/components/atoms/Button";
import ShareModal from "@/components/molecules/ShareModal";
import { useToast } from "@/components/atoms/ToastProvider";
import { USER_PROFILES } from "@/lib/constants";

// ── Types ─────────────────────────────────────────────────────────────────────
interface Share { id: string; userId: string; permission: "view" | "edit" }
interface Doc {
  id: string; title: string; content: string;
  createdAt: string; updatedAt: string; owner: string;
  shares?: Share[];
}

// ── Template configuration (no inline magic strings) ────────────────────────
const TEMPLATES = [
  { id: "blank",            name: "Blank Document",    Icon: Plus,     color: "text-zinc-500 bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-400" },
  { id: "meeting-notes",    name: "Meeting Notes",     Icon: Users,    color: "text-blue-600 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-400" },
  { id: "project-proposal", name: "Project Proposal",  Icon: Briefcase,color: "text-purple-600 bg-purple-50 dark:bg-purple-950/30 dark:text-purple-400" },
  { id: "software-spec",    name: "Software Spec",     Icon: Laptop,   color: "text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-400" },
] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Document card (grid) ──────────────────────────────────────────────────────
function DocCard({
  doc, isShared, myPermission, onDelete, onShare,
}: {
  doc: Doc; isShared: boolean; myPermission?: "view" | "edit";
  onDelete: (id: string, e: React.MouseEvent) => void;
  onShare: (doc: Doc) => void;
}) {
  return (
    <Link
      href={`/documents/${doc.id}`}
      className="flex flex-col justify-between p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl hover:shadow-lg hover:-translate-y-0.5 transition-all text-left relative group min-h-[160px]"
    >
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <FileText className="text-indigo-500 shrink-0" size={22} />
          <div className="flex items-center gap-1 ml-auto">
            {isShared ? (
              <Badge variant="shared">Shared with me</Badge>
            ) : (
              <Badge variant="owned"><Crown size={8} /> Mine</Badge>
            )}
            {myPermission && (
              <Badge variant={myPermission === "edit" ? "edit" : "view"}>{myPermission}</Badge>
            )}
          </div>
        </div>
        <h3 className="text-sm font-bold text-zinc-900 dark:text-zinc-50 line-clamp-2 mt-1">
          {doc.title}
        </h3>
      </div>

      <div className="flex items-center justify-between border-t border-zinc-100 dark:border-zinc-800/80 pt-3 mt-4">
        <div className="flex items-center gap-1.5 text-[10px] text-zinc-400">
          <Calendar size={10} />
          <span>{formatDate(doc.updatedAt)}</span>
        </div>

        <div className="flex items-center gap-1">
          {/* Share button — owner only */}
          {!isShared && (
            <button
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShare(doc); }}
              title="Manage sharing"
              className="p-1 text-zinc-300 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 dark:text-zinc-700 rounded-lg transition-colors z-20"
            >
              <Share2 size={13} />
            </button>
          )}
          {!isShared && (
            <button
              onClick={(e) => onDelete(doc.id, e)}
              title="Delete document"
              className="p-1 text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 dark:text-zinc-700 rounded-lg transition-colors z-20"
            >
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>
    </Link>
  );
}

// ── List row ──────────────────────────────────────────────────────────────────
function DocRow({
  doc, isShared, myPermission, onDelete, onShare,
}: {
  doc: Doc; isShared: boolean; myPermission?: "view" | "edit";
  onDelete: (id: string, e: React.MouseEvent) => void;
  onShare: (doc: Doc) => void;
}) {
  return (
    <Link
      href={`/documents/${doc.id}`}
      className="flex items-center justify-between p-4 hover:bg-zinc-50 dark:hover:bg-zinc-800/20 transition-all relative"
    >
      <div className="flex items-center gap-3 min-w-0 pr-4">
        <FileText className="text-indigo-500 shrink-0" size={18} />
        <span className="text-sm font-bold text-zinc-900 dark:text-zinc-50 truncate">{doc.title}</span>
        {isShared ? (
          <Badge variant="shared">Shared</Badge>
        ) : (
          <Badge variant="owned"><Crown size={8} /> Mine</Badge>
        )}
        {myPermission && (
          <Badge variant={myPermission === "edit" ? "edit" : "view"}>{myPermission}</Badge>
        )}
      </div>

      <div className="flex items-center gap-4 shrink-0">
        <span className="hidden sm:block text-[11px] text-zinc-400">{formatDate(doc.updatedAt)}</span>
        <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-50 dark:bg-zinc-800 px-2 py-0.5 rounded-md">
          {doc.owner.split(" ")[0]}
        </span>
        {!isShared && (
          <>
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); onShare(doc); }} title="Share"
              className="p-1.5 text-zinc-300 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/20 dark:text-zinc-700 rounded-lg transition-colors">
              <Share2 size={13} />
            </button>
            <button onClick={(e) => onDelete(doc.id, e)} title="Delete"
              className="p-1.5 text-zinc-300 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 dark:text-zinc-700 rounded-lg transition-colors">
              <Trash2 size={13} />
            </button>
          </>
        )}
      </div>
    </Link>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function Home() {
  const { addToast } = useToast();

  const [allDocs, setAllDocs]         = useState<Doc[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode]       = useState<"grid" | "list">("grid");
  const [activeUserIndex, setActiveUserIndex] = useState(0);
  const [isLoading, setIsLoading]     = useState(true);
  const [shareTarget, setShareTarget] = useState<Doc | null>(null);

  const activeUser = USER_PROFILES[activeUserIndex];

  // Persist active user selection
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("active_user_index", activeUserIndex.toString());
    }
  }, [activeUserIndex]);

  // Restore from localStorage on mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("active_user_index");
      if (saved !== null) setActiveUserIndex(parseInt(saved, 10));
    }
  }, []);

  // Fetch all documents
  const fetchDocuments = useCallback(async () => {
    try {
      const res = await fetch("/api/documents");
      if (!res.ok) throw new Error(await res.text());
      setAllDocs(await res.json());
    } catch {
      addToast("error", "Could not load documents. Check your connection.");
    } finally {
      setIsLoading(false);
    }
  }, [addToast]);

  useEffect(() => { fetchDocuments(); }, [fetchDocuments]);

  // Split docs into owned vs shared-with-me
  const ownedDocs  = allDocs.filter((d) => d.owner === activeUser.name);
  const sharedDocs = allDocs.filter((d) =>
    d.owner !== activeUser.name &&
    (d.shares ?? []).some((s) => s.userId === activeUser.id)
  );

  // Search filter applied to active section
  const filteredOwned  = ownedDocs.filter((d)  => d.title.toLowerCase().includes(searchQuery.toLowerCase()));
  const filteredShared = sharedDocs.filter((d) => d.title.toLowerCase().includes(searchQuery.toLowerCase()));

  // Create document
  const handleCreate = async (templateId: string) => {
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title:    templateId === "blank" ? "Untitled Document" : "",
          template: templateId !== "blank" ? templateId : undefined,
          owner:    activeUser.name,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json().catch(() => ({ error: "Unknown error" }));
        addToast("error", `Could not create document: ${error}`);
        return;
      }
      const newDoc = await res.json();
      window.location.href = `/documents/${newDoc.id}`;
    } catch {
      addToast("error", "Network error — document not created.");
    }
  };

  // Delete document
  const handleDelete = async (docId: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!window.confirm("Delete this document? This cannot be undone.")) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (!res.ok) {
        addToast("error", "Failed to delete document.");
        return;
      }
      setAllDocs((prev) => prev.filter((d) => d.id !== docId));
      addToast("success", "Document deleted.");
    } catch {
      addToast("error", "Network error — document not deleted.");
    }
  };

  // ── Render section helper ─────────────────────────────────────────────────
  const renderSection = (docs: Doc[], isSharedSection: boolean) => {
    if (docs.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center border border-dashed border-zinc-200 dark:border-zinc-800 rounded-3xl p-10 text-center bg-white dark:bg-zinc-900/20">
          <FileText size={40} className="text-zinc-300 dark:text-zinc-700 mb-2" />
          <p className="text-sm font-semibold text-zinc-500">
            {isSharedSection
              ? "No documents have been shared with you yet."
              : searchQuery
              ? "No matching documents."
              : "No documents yet — create one above!"}
          </p>
        </div>
      );
    }

    const cardProps = (doc: Doc) => {
      const myShare = (doc.shares ?? []).find((s) => s.userId === activeUser.id);
      return { myPermission: myShare?.permission as "view" | "edit" | undefined };
    };

    return viewMode === "grid" ? (
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        {docs.map((doc) => (
          <DocCard
            key={doc.id} doc={doc}
            isShared={isSharedSection}
            {...cardProps(doc)}
            onDelete={handleDelete}
            onShare={setShareTarget}
          />
        ))}
      </div>
    ) : (
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl overflow-hidden divide-y divide-zinc-100 dark:divide-zinc-800/80">
        {docs.map((doc) => (
          <DocRow
            key={doc.id} doc={doc}
            isShared={isSharedSection}
            {...cardProps(doc)}
            onDelete={handleDelete}
            onShare={setShareTarget}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="flex-1 w-full min-h-screen bg-zinc-50 dark:bg-zinc-950 flex flex-col font-sans">

      {/* Header */}
      <header className="sticky top-0 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md border-b border-zinc-200 dark:border-zinc-800/80 z-30 select-none">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600 rounded-xl text-white shadow-md shadow-indigo-500/20">
              <Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-md font-bold tracking-tight text-zinc-900 dark:text-zinc-50">Antigravity Docs</h1>
              <p className="text-[10px] text-zinc-400 font-medium">LIGHTWEIGHT COLLABORATION</p>
            </div>
          </div>

          {/* User switcher */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-zinc-400 font-medium hidden sm:block">Active user:</span>
            <div className="flex bg-zinc-100 dark:bg-zinc-800 p-0.5 rounded-lg border border-zinc-200 dark:border-zinc-700/50">
              {USER_PROFILES.map((profile, index) => (
                <button
                  key={profile.id}
                  onClick={() => setActiveUserIndex(index)}
                  className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold transition-all ${
                    activeUserIndex === index
                      ? "bg-white dark:bg-zinc-700 text-zinc-900 dark:text-zinc-100 shadow-sm"
                      : "text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                  }`}
                >
                  <div className={`w-2 h-2 rounded-full ${profile.bg}`} />
                  <span>{profile.name.split(" ")[0]}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 flex-1 flex flex-col gap-8 w-full">

        {/* Templates */}
        <section className="space-y-3 select-none">
          <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
            Start a new document
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {TEMPLATES.map((tmpl) => (
              <button
                key={tmpl.id}
                onClick={() => handleCreate(tmpl.id)}
                className="flex flex-col items-start gap-4 p-5 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl hover:border-indigo-500 dark:hover:border-indigo-400 hover:shadow-lg hover:shadow-indigo-500/5 transition-all text-left group"
              >
                <div className={`p-3 rounded-xl ${tmpl.color}`}><tmpl.Icon size={20} /></div>
                <div>
                  <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                    {tmpl.name}
                  </h3>
                  <p className="text-[11px] text-zinc-400 mt-0.5">Use template</p>
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Search + view toggle toolbar */}
        <section className="flex flex-col sm:flex-row gap-4 justify-between items-center bg-white dark:bg-zinc-900 p-4 border border-zinc-200 dark:border-zinc-800/80 rounded-2xl">
          <div className="relative w-full sm:max-w-xs">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-zinc-400" />
            <input
              type="text"
              placeholder="Search documents…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-200 dark:border-zinc-800 rounded-xl focus:outline-none focus:border-indigo-500 transition-colors text-zinc-800 dark:text-zinc-200"
            />
          </div>
          <div className="flex items-center gap-2 self-end sm:self-auto">
            <Button variant="ghost" size="sm" icon={<Grid size={16} />}
              className={viewMode === "grid" ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100" : ""}
              onClick={() => setViewMode("grid")} aria-label="Grid view" />
            <Button variant="ghost" size="sm" icon={<ListIcon size={16} />}
              className={viewMode === "list" ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100" : ""}
              onClick={() => setViewMode("list")} aria-label="List view" />
          </div>
        </section>

        {/* Loading */}
        {isLoading ? (
          <div className="flex items-center justify-center py-20 gap-3 text-zinc-400">
            <Spinner /> <span>Loading documents…</span>
          </div>
        ) : (
          <>
            {/* My Documents */}
            <section className="flex-1 flex flex-col gap-3">
              <div className="flex justify-between items-center select-none">
                <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                  My Documents
                </h2>
                <span className="text-[11px] text-zinc-400">
                  {filteredOwned.length} doc{filteredOwned.length !== 1 ? "s" : ""}
                </span>
              </div>
              {renderSection(filteredOwned, false)}
            </section>

            {/* Shared with Me */}
            <section className="flex flex-col gap-3">
              <div className="flex justify-between items-center select-none">
                <h2 className="text-xs font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider flex items-center gap-1.5">
                  <Users size={12} /> Shared with Me
                </h2>
                <span className="text-[11px] text-zinc-400">
                  {filteredShared.length} doc{filteredShared.length !== 1 ? "s" : ""}
                </span>
              </div>
              {renderSection(filteredShared, true)}
            </section>
          </>
        )}
      </main>

      <footer className="py-5 border-t border-zinc-200 dark:border-zinc-800 text-center select-none">
        <p className="text-[11px] text-zinc-400">
          Logged in as{" "}
          <span className="font-semibold text-zinc-700 dark:text-zinc-300">{activeUser.name}</span>
          {" "}· Antigravity Docs Workspace
        </p>
      </footer>

      {/* Share modal */}
      {shareTarget && (
        <ShareModal
          documentId={shareTarget.id}
          documentTitle={shareTarget.title}
          ownerName={shareTarget.owner}
          activeUser={activeUser}
          onClose={() => { setShareTarget(null); fetchDocuments(); }}
        />
      )}
    </div>
  );
}
