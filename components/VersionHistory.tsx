"use client";

import React from "react";
import { History, RotateCcw, Calendar, User } from "lucide-react";
import { DocumentVersion } from "@/lib/db";

interface VersionHistoryProps {
  history: DocumentVersion[];
  onRestore: (versionId: string) => void;
}

export default function VersionHistory({ history, onRestore }: VersionHistoryProps) {
  const sortedHistory = [...history].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-900 rounded-xl border border-zinc-200 dark:border-zinc-800 p-4 select-none">
      <div className="flex items-center gap-2 pb-3 mb-3 border-b border-zinc-100 dark:border-zinc-800/80">
        <History size={16} className="text-zinc-500" />
        <h3 className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          Version History
        </h3>
      </div>

      {sortedHistory.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
          <History size={24} className="text-zinc-300 dark:text-zinc-700 mb-2" />
          <p className="text-xs text-zinc-400 dark:text-zinc-500 max-w-[160px]">
            No older versions saved yet. Versions are auto-saved as you edit.
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto space-y-3 pr-1 font-sans">
          {sortedHistory.map((version, index) => {
            const date = new Date(version.updatedAt);
            const formattedDate = date.toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            });
            const formattedTime = date.toLocaleTimeString(undefined, {
              hour: "2-digit",
              minute: "2-digit",
              second: "2-digit",
            });

            return (
              <div
                key={version.id}
                className={`relative p-3 rounded-xl border transition-all ${
                  index === 0
                    ? "bg-indigo-50/40 border-indigo-100 dark:bg-indigo-950/10 dark:border-indigo-900/40"
                    : "bg-zinc-50/50 border-zinc-100 dark:bg-zinc-800/20 dark:border-zinc-800/60"
                }`}
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Calendar size={12} className="text-zinc-400 shrink-0" />
                      <span>{formattedDate}</span>
                      <span className="text-zinc-300 dark:text-zinc-700 hidden sm:inline">•</span>
                      <span className="text-[11px] text-zinc-500">{formattedTime}</span>
                    </div>
                    {index === 0 && (
                      <span className="shrink-0 text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 bg-indigo-100/50 dark:bg-indigo-900/40 px-1.5 py-0.5 rounded">
                        Current
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 text-[11px] text-zinc-500 dark:text-zinc-400">
                    <User size={10} className="text-zinc-400" />
                    <span className="font-medium truncate max-w-[130px]">
                      By {version.updatedBy}
                    </span>
                  </div>

                  <div className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate max-w-[170px]">
                    Title: &quot;{version.title}&quot;
                  </div>

                  {index > 0 && (
                    <button
                      onClick={() => onRestore(version.id)}
                      className="mt-2 flex items-center justify-center gap-1 w-full py-1 px-2.5 bg-zinc-900 hover:bg-zinc-800 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-white rounded-lg text-[10px] font-semibold transition-all shadow-sm"
                    >
                      <RotateCcw size={10} />
                      <span>Restore This Revision</span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
