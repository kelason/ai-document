// app/api/documents/[id]/upload/route.ts
// ─────────────────────────────────────────
// POST: Accept a file upload (multipart/form-data), validate it, parse its
// content to HTML, store an attachment record, and return the HTML for the
// client to inject into the editor.
//
// Supported types:
//   .txt  → plain text wrapped in <p> tags
//   .md   → markdown converted to HTML (basic built-in converter)
//   .docx → converted to HTML via mammoth.js

import { NextRequest, NextResponse } from "next/server";
import { getDocumentById, createAttachment } from "@/lib/db";
import {
  MAX_FILE_SIZE_BYTES,
  SUPPORTED_EXTENSIONS,
  API_ERROR_CODES,
  type SupportedExtension,
} from "@/lib/constants";

type Params = { params: Promise<{ id: string }> };

// ── Simple Markdown → HTML converter ────────────────────────────────────────
function markdownToHtml(md: string): string {
  const lines = md.split("\n");
  const html: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) { html.push("<br>"); continue; }

    // ATX headings
    const h3 = trimmed.match(/^###\s+(.+)/);
    const h2 = trimmed.match(/^##\s+(.+)/);
    const h1 = trimmed.match(/^#\s+(.+)/);
    if (h1) { html.push(`<h1>${h1[1]}</h1>`); continue; }
    if (h2) { html.push(`<h2>${h2[1]}</h2>`); continue; }
    if (h3) { html.push(`<h3>${h3[1]}</h3>`); continue; }

    // Unordered list item
    if (/^[-*+]\s+/.test(trimmed)) {
      html.push(`<ul><li>${inlineFormat(trimmed.replace(/^[-*+]\s+/, ""))}</li></ul>`);
      continue;
    }
    // Ordered list item
    if (/^\d+\.\s+/.test(trimmed)) {
      html.push(`<ol><li>${inlineFormat(trimmed.replace(/^\d+\.\s+/, ""))}</li></ol>`);
      continue;
    }

    html.push(`<p>${inlineFormat(trimmed)}</p>`);
  }

  return html.join("");
}

function inlineFormat(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/_(.+?)_/g,       "<em>$1</em>")
    .replace(/`(.+?)`/g,       "<code>$1</code>")
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
}

// ── Plain text → HTML ────────────────────────────────────────────────────────
function plainTextToHtml(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.trim() ? `<p>${line.trim()}</p>` : "<br>"))
    .join("");
}

// ── Route handler ─────────────────────────────────────────────────────────────
export async function POST(req: NextRequest, { params }: Params) {
  const { id } = await params;

  // ── Verify document exists ────────────────────────────────────────────────
  const doc = await getDocumentById(id);
  if (!doc) {
    return NextResponse.json(
      { error: "Document not found.", code: API_ERROR_CODES.NOT_FOUND },
      { status: 404 }
    );
  }

  // ── Parse multipart form data ─────────────────────────────────────────────
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Request must be multipart/form-data.", code: API_ERROR_CODES.VALIDATION_ERROR },
      { status: 400 }
    );
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || typeof fileEntry === "string") {
    return NextResponse.json(
      { error: 'A file field named "file" is required.', code: API_ERROR_CODES.VALIDATION_ERROR },
      { status: 400 }
    );
  }

  const file = fileEntry as File;
  const filename = file.name;
  const extMatch = filename.match(/\.[^.]+$/);
  const ext = extMatch ? extMatch[0].toLowerCase() : "";

  // ── Validate extension ───────────────────────────────────────────────────
  if (!SUPPORTED_EXTENSIONS.includes(ext as SupportedExtension)) {
    return NextResponse.json(
      {
        error: `File type "${ext}" is not supported. Please upload one of: ${SUPPORTED_EXTENSIONS.join(", ")}`,
        code: API_ERROR_CODES.UNSUPPORTED_TYPE,
      },
      { status: 415 }
    );
  }

  // ── Validate size ────────────────────────────────────────────────────────
  if (file.size > MAX_FILE_SIZE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return NextResponse.json(
      {
        error: `File is ${mb} MB. Maximum allowed size is ${MAX_FILE_SIZE_BYTES / (1024 * 1024)} MB.`,
        code: API_ERROR_CODES.FILE_TOO_LARGE,
      },
      { status: 413 }
    );
  }

  // ── Parse content ────────────────────────────────────────────────────────
  let html = "";
  try {
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    if (ext === ".docx") {
      const mammoth = await import("mammoth");
      const result = await mammoth.convertToHtml({ buffer });
      html = result.value;
      if (!html.trim()) throw new Error("mammoth returned empty output");
    } else if (ext === ".md") {
      const text = buffer.toString("utf-8");
      html = markdownToHtml(text);
    } else {
      // .txt
      const text = buffer.toString("utf-8");
      html = plainTextToHtml(text);
    }
  } catch (err: any) {
    return NextResponse.json(
      {
        error: `Could not parse the file: ${err?.message ?? "unknown error"}.`,
        code: API_ERROR_CODES.PARSE_FAILED,
      },
      { status: 422 }
    );
  }

  // ── Store attachment record ──────────────────────────────────────────────
  // (No external storage bucket — url is a descriptive placeholder)
  const attachment = await createAttachment(
    id,
    filename,
    file.type || `application/octet-stream`,
    file.size,
    `/documents/${id}/attachments/${encodeURIComponent(filename)}`
  );

  return NextResponse.json({
    success: true,
    filename,
    html,
    attachment,
    message: `File "${filename}" parsed and imported successfully.`,
  });
}
