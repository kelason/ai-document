// components/molecules/FileUploadDropzone.tsx
// ─────────────────────────────────────────────
// Molecule: Drag-and-drop file upload area.
// Validates file type (txt, md, docx only) and size (max 5 MB).
// On success, calls onUploaded(parsedHtml, filename) so the parent can
// inject the content into the editor or create a new document.

"use client";

import React, { useRef, useState, useCallback } from "react";
import { X, Upload, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";
import Button from "@/components/atoms/Button";
import Spinner from "@/components/atoms/Spinner";
import { useToast } from "@/components/atoms/ToastProvider";
import {
  MAX_FILE_SIZE_BYTES,
  MAX_FILE_SIZE_LABEL,
  SUPPORTED_EXTENSIONS,
  SUPPORTED_EXTENSIONS_LABEL,
} from "@/lib/constants";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getExtension(filename: string): string {
  const dot = filename.lastIndexOf(".");
  return dot === -1 ? "" : filename.slice(dot).toLowerCase();
}

// ── Component ────────────────────────────────────────────────────────────────

interface FileUploadDropzoneProps {
  documentId: string;        // target document to attach the content to
  onUploaded: (parsedHtml: string, filename: string) => void;
  onClose: () => void;
}

type UploadState = "idle" | "invalid" | "ready" | "uploading" | "success" | "error";

export default function FileUploadDropzone({
  documentId,
  onUploaded,
  onClose,
}: FileUploadDropzoneProps) {
  const { addToast } = useToast();

  const [file, setFile]               = useState<File | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [validationMsg, setValidMsg]  = useState("");
  const [isDragOver, setIsDragOver]   = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Validation ──────────────────────────────────────────────────────────────
  const validate = useCallback((f: File): string | null => {
    const ext = getExtension(f.name);
    if (!SUPPORTED_EXTENSIONS.includes(ext as any)) {
      return `Unsupported file type "${ext}". Accepted: ${SUPPORTED_EXTENSIONS_LABEL}`;
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      return `File is ${formatBytes(f.size)} — max allowed size is ${MAX_FILE_SIZE_LABEL}.`;
    }
    return null;
  }, []);

  const handleFile = useCallback((f: File) => {
    const error = validate(f);
    if (error) {
      setFile(null);
      setValidMsg(error);
      setUploadState("invalid");
    } else {
      setFile(f);
      setValidMsg("");
      setUploadState("ready");
    }
  }, [validate]);

  // ── Drag events ─────────────────────────────────────────────────────────────
  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragOver(true); };
  const onDragLeave = () => setIsDragOver(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped) handleFile(dropped);
  };

  // ── File input change ────────────────────────────────────────────────────────
  const onInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) handleFile(selected);
  };

  // ── Upload ────────────────────────────────────────────────────────────────────
  const handleUpload = async () => {
    if (!file) return;

    setUploadState("uploading");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/documents/${documentId}/upload`, {
        method: "POST",
        body: formData,
      });

      const body = await res.json();

      if (!res.ok) {
        setUploadState("error");
        setValidMsg(body.error ?? "Upload failed. Please try again.");
        addToast("error", body.error ?? "Upload failed.");
        return;
      }

      setUploadState("success");
      addToast("success", `"${file.name}" imported successfully!`);
      setTimeout(() => {
        onUploaded(body.html, file.name);
        onClose();
      }, 900);
    } catch {
      setUploadState("error");
      setValidMsg("Network error — upload could not complete.");
      addToast("error", "Network error during upload.");
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Import file"
    >
      <div className="w-full max-w-md bg-white dark:bg-zinc-900 rounded-2xl shadow-2xl border border-zinc-200 dark:border-zinc-800 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Upload size={16} className="text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="text-sm font-bold text-zinc-900 dark:text-zinc-50">Import File</h2>
              <p className="text-[10px] text-zinc-400">
                Supported: {SUPPORTED_EXTENSIONS_LABEL} · Max {MAX_FILE_SIZE_LABEL}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="xs" icon={<X size={14} />} onClick={onClose} aria-label="Close" />
        </div>

        <div className="p-5 space-y-4">
          {/* Drop zone */}
          <div
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`relative flex flex-col items-center justify-center gap-3 p-8 rounded-2xl border-2 border-dashed cursor-pointer transition-all ${
              isDragOver
                ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/20"
                : uploadState === "invalid" || uploadState === "error"
                ? "border-red-400 bg-red-50 dark:bg-red-950/10"
                : uploadState === "success"
                ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/10"
                : file
                ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/10"
                : "border-zinc-200 dark:border-zinc-700 hover:border-indigo-400 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/10"
            }`}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.md,.docx"
              onChange={onInputChange}
              className="sr-only"
              aria-label="File input"
            />

            {uploadState === "uploading" ? (
              <>
                <Spinner size="lg" />
                <span className="text-sm text-zinc-500">Importing…</span>
              </>
            ) : uploadState === "success" ? (
              <>
                <CheckCircle2 size={36} className="text-emerald-500" />
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                  Import successful!
                </span>
              </>
            ) : file ? (
              <>
                <FileText size={36} className="text-indigo-500" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">{file.name}</p>
                  <p className="text-xs text-zinc-400">{formatBytes(file.size)}</p>
                </div>
              </>
            ) : (
              <>
                <Upload size={32} className="text-zinc-300 dark:text-zinc-600" />
                <div className="text-center">
                  <p className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                    Drag & drop or click to browse
                  </p>
                  <p className="text-[11px] text-zinc-400 mt-0.5">
                    {SUPPORTED_EXTENSIONS_LABEL} up to {MAX_FILE_SIZE_LABEL}
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Validation / error message */}
          {validationMsg && (
            <div className="flex items-start gap-2 p-3 bg-red-50 dark:bg-red-950/20 rounded-xl border border-red-200 dark:border-red-800">
              <AlertTriangle size={14} className="text-red-500 shrink-0 mt-0.5" />
              <p className="text-xs text-red-700 dark:text-red-300">{validationMsg}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              icon={<Upload size={13} />}
              loading={uploadState === "uploading"}
              disabled={!file || uploadState === "invalid" || uploadState === "uploading" || uploadState === "success"}
              onClick={handleUpload}
            >
              Import into document
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
