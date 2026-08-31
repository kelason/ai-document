import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";

export interface DocumentVersion {
  id: string;
  title: string;
  content: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Document {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  owner: string;
  history: DocumentVersion[];
  // Optional relational data – present when fetched with shares/attachments
  shares?: DocumentShare[];
  attachments?: DocumentAttachment[];
}

// -----------------------------------------------------------------------------
// Sharing & Attachments
// -----------------------------------------------------------------------------
export interface DocumentShare {
  id: string;               // UUID primary key in Supabase
  documentId: string;
  userId: string;           // matches a simulated user profile id
  permission: "view" | "edit";
  createdAt: string;
}

export interface DocumentAttachment {
  id: string;               // UUID primary key
  documentId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  url: string;              // public URL from Supabase storage or placeholder
  uploadedAt: string;
}

const isVercel = !!process.env.VERCEL;
const DATA_DIR = isVercel ? path.join("/tmp", "data") : path.join(process.cwd(), "data");
const DB_FILE = path.join(DATA_DIR, "documents.json");

// Supabase configuration
let supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
if (supabaseUrl.endsWith("/rest/v1/")) {
  supabaseUrl = supabaseUrl.slice(0, -9);
} else if (supabaseUrl.endsWith("/rest/v1")) {
  supabaseUrl = supabaseUrl.slice(0, -8);
}
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const isSupabaseEnabled = !!(supabaseUrl && supabaseKey);
const supabaseClient = isSupabaseEnabled ? createClient(supabaseUrl, supabaseKey!) : null;

if (isSupabaseEnabled) {
  console.log("Supabase DB adapter enabled!");
} else {
  console.log("Supabase env vars missing. Falling back to local file JSON database.");
}

// Local JSON file db helpers
function ensureDb() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(DB_FILE)) {
      fs.writeFileSync(DB_FILE, JSON.stringify([], null, 2), "utf-8");
    }
  } catch (err) {
    console.error("ensureDb failed (read-only filesystem?):", err);
  }
}

let memoryCache: Document[] | null = null;

function getLocalDocuments(): Document[] {
  ensureDb();
  if (memoryCache) return memoryCache;
  try {
    const data = fs.readFileSync(DB_FILE, "utf-8");
    memoryCache = JSON.parse(data) as Document[];
    return memoryCache;
  } catch (error) {
    console.error("Failed to read local database:", error);
    memoryCache = [];
    return memoryCache;
  }
}

function saveLocalDocuments(docs: Document[]) {
  ensureDb();
  memoryCache = docs;
  try {
    fs.writeFileSync(DB_FILE, JSON.stringify(docs, null, 2), "utf-8");
  } catch (error) {
    console.error("Failed to write to local database:", error);
  }
}

// Unified Database API

export async function getDocuments(): Promise<Document[]> {
  if (isSupabaseEnabled && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from("documents")
        .select("*")
        .order("updated_at", { ascending: false });

      if (error) throw error;

      // Also fetch all shares for the dashboard partition (owned vs shared-with-me)
      const { data: allShares } = await supabaseClient.from("document_shares").select("*");

      return (data || []).map((doc) => ({
        id: doc.id,
        title: doc.title,
        content: doc.content,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        owner: doc.owner,
        history: [], // fetched lazily in getDocumentById
        shares: (allShares ?? [])
          .filter((s: any) => s.document_id === doc.id)
          .map((s: any) => ({
            id: s.id,
            documentId: s.document_id,
            userId: s.user_id,
            permission: s.permission,
            createdAt: s.created_at,
          })),
      }));
    } catch (e) {
      console.error("Supabase getDocuments error, falling back to local:", e);
    }
  }

  // Local fallback (shares already embedded in doc records)
  return getLocalDocuments();
}


export async function getDocumentById(id: string): Promise<Document | undefined> {
  if (isSupabaseEnabled && supabaseClient) {
    try {
      // Fetch document
      const { data: doc, error: docError } = await supabaseClient
        .from("documents")
        .select("*")
        .eq("id", id)
        .single();

      if (docError) {
        // PGRST116 = row not found (expected when doc doesn't exist)
        if (docError.code === "PGRST116") {
          console.log(`[Supabase] Document ${id} not found in Supabase, checking local fallback...`);
        } else {
          console.error(`[Supabase] getDocumentById error (code: ${docError.code}):`, docError.message, docError.details, docError.hint);
          console.error("[Supabase] This may be caused by RLS blocking the anon key. Run supabase_schema.sql to fix.");
        }
        // Fall through to local JSON
        const docs = getLocalDocuments();
        return docs.find((d) => d.id === id);
      }

      if (!doc) {
        // No error but no row - fall through to local
        const docs = getLocalDocuments();
        return docs.find((d) => d.id === id);
      }

      // Fetch history
      const { data: historyData, error: historyError } = await supabaseClient
        .from("document_history")
        .select("*")
        .eq("document_id", id)
        .order("updated_at", { ascending: true });

      if (historyError) {
        console.error(`[Supabase] document_history fetch error:`, historyError.message);
      }

      const history: DocumentVersion[] = (historyData || []).map((v) => ({
        id: v.id,
        title: v.title,
        content: v.content,
        updatedAt: v.updated_at,
        updatedBy: v.updated_by,
      }));

      // New: fetch shares
      const { data: sharesData, error: sharesError } = await supabaseClient
        .from("document_shares")
        .select("*")
        .eq("document_id", id);
      const shares: DocumentShare[] = (sharesData || []).map((s: any) => ({
        id: s.id,
        documentId: s.document_id,
        userId: s.user_id,
        permission: s.permission,
        createdAt: s.created_at,
      }));

      // New: fetch attachments
      const { data: attachData, error: attachError } = await supabaseClient
        .from("document_attachments")
        .select("*")
        .eq("document_id", id);
      const attachments: DocumentAttachment[] = (attachData || []).map((a: any) => ({
        id: a.id,
        documentId: a.document_id,
        filename: a.filename,
        mimeType: a.mime_type,
        sizeBytes: Number(a.size_bytes),
        url: a.url,
        uploadedAt: a.uploaded_at,
      }));

      if (sharesError) console.error(`[Supabase] document_shares fetch error:`, sharesError.message);
      if (attachError) console.error(`[Supabase] document_attachments fetch error:`, attachError.message);

      return {
        id: doc.id,
        title: doc.title,
        content: doc.content,
        createdAt: doc.created_at,
        updatedAt: doc.updated_at,
        owner: doc.owner,
        history,
        shares,
        attachments,
      };
    } catch (e) {
      console.error("[Supabase] getDocumentById unexpected error, falling back to local:", e);
    }
  }

  const docs = getLocalDocuments();
  return docs.find((d) => d.id === id);
}

export async function createDocument(
  title: string,
  content: string = "",
  owner: string = "Anonymous"
): Promise<Document> {
  const id = Math.random().toString(36).substring(2, 11);
  const now = new Date().toISOString();

  const newDoc: Document = {
    id,
    title: title.trim() || "Untitled Document",
    content,
    createdAt: now,
    updatedAt: now,
    owner,
    history: [],
  };

  const initialHistory: DocumentVersion = {
    id: Math.random().toString(36).substring(2, 11),
    title: newDoc.title,
    content: newDoc.content,
    updatedAt: now,
    updatedBy: owner,
  };

  newDoc.history.push(initialHistory);

  if (isSupabaseEnabled && supabaseClient) {
    try {
      const { error: docError } = await supabaseClient.from("documents").insert({
        id: newDoc.id,
        title: newDoc.title,
        content: newDoc.content,
        created_at: newDoc.createdAt,
        updated_at: newDoc.updatedAt,
        owner: newDoc.owner,
      });

      if (docError) throw docError;

      const { error: histError } = await supabaseClient.from("document_history").insert({
        id: initialHistory.id,
        document_id: newDoc.id,
        title: initialHistory.title,
        content: initialHistory.content,
        updated_at: initialHistory.updatedAt,
        updated_by: initialHistory.updatedBy,
      });

      if (histError) throw histError;

      return newDoc;
    } catch (e) {
      console.error("Supabase createDocument error, falling back to local:", e);
    }
  }

  // Fallback
  const docs = getLocalDocuments();
  docs.unshift(newDoc);
  saveLocalDocuments(docs);
  return newDoc;
}

export async function updateDocument(
  id: string,
  updates: { title?: string; content?: string; updatedBy?: string; createVersion?: boolean }
): Promise<Document | undefined> {
  const updatedBy = updates.updatedBy || "Anonymous";
  const now = new Date().toISOString();

  if (isSupabaseEnabled && supabaseClient) {
    try {
      // Get active state
      const currentDoc = await getDocumentById(id);
      if (!currentDoc) return undefined;

      let changed = false;
      const dbUpdates: Record<string, any> = {};

      if (updates.title !== undefined && currentDoc.title !== updates.title) {
        dbUpdates.title = updates.title.trim() || "Untitled Document";
        currentDoc.title = dbUpdates.title;
        changed = true;
      }

      if (updates.content !== undefined && currentDoc.content !== updates.content) {
        dbUpdates.content = updates.content;
        currentDoc.content = dbUpdates.content;
        changed = true;
      }

      if (changed) {
        dbUpdates.updated_at = now;
        currentDoc.updatedAt = now;

        const { error: docError } = await supabaseClient
          .from("documents")
          .update(dbUpdates)
          .eq("id", id);

        if (docError) throw docError;

        // Versioning logic
        let shouldCreateVersion = updates.createVersion || currentDoc.history.length === 0;

        if (!shouldCreateVersion && currentDoc.history.length > 0) {
          const lastVersion = currentDoc.history[currentDoc.history.length - 1];
          const timeDiff = new Date().getTime() - new Date(lastVersion.updatedAt).getTime();

          if (timeDiff < 15000 && lastVersion.updatedBy === updatedBy) {
            // Update last version in-place
            const { error: updHistError } = await supabaseClient
              .from("document_history")
              .update({
                content: currentDoc.content,
                title: currentDoc.title,
                updated_at: now,
              })
              .eq("id", lastVersion.id);

            if (updHistError) throw updHistError;
          } else {
            shouldCreateVersion = true;
          }
        }

        if (shouldCreateVersion) {
          const newHistId = Math.random().toString(36).substring(2, 11);
          const { error: insHistError } = await supabaseClient.from("document_history").insert({
            id: newHistId,
            document_id: id,
            title: currentDoc.title,
            content: currentDoc.content,
            updated_at: now,
            updated_by: updatedBy,
          });

          if (insHistError) throw insHistError;
        }
      }

      return await getDocumentById(id);
    } catch (e) {
      console.error("Supabase updateDocument error, falling back to local:", e);
    }
  }

  // Fallback
  const docs = getLocalDocuments();
  const docIndex = docs.findIndex((d) => d.id === id);
  if (docIndex === -1) return undefined;

  const doc = docs[docIndex];
  let changed = false;

  if (updates.title !== undefined && doc.title !== updates.title) {
    doc.title = updates.title.trim() || "Untitled Document";
    changed = true;
  }

  if (updates.content !== undefined && doc.content !== updates.content) {
    doc.content = updates.content;
    changed = true;
  }

  if (changed) {
    doc.updatedAt = now;

    if (updates.createVersion || doc.history.length === 0) {
      if (doc.history.length >= 50) doc.history.shift();
      doc.history.push({
        id: Math.random().toString(36).substring(2, 11),
        title: doc.title,
        content: doc.content,
        updatedAt: now,
        updatedBy,
      });
    } else {
      const lastVersion = doc.history[doc.history.length - 1];
      const timeDiff = new Date().getTime() - new Date(lastVersion.updatedAt).getTime();

      if (timeDiff < 15000 && lastVersion.updatedBy === updatedBy) {
        lastVersion.content = doc.content;
        lastVersion.title = doc.title;
        lastVersion.updatedAt = now;
      } else {
        if (doc.history.length >= 50) doc.history.shift();
        doc.history.push({
          id: Math.random().toString(36).substring(2, 11),
          title: doc.title,
          content: doc.content,
          updatedAt: now,
          updatedBy,
        });
      }
    }

    docs[docIndex] = doc;
    saveLocalDocuments(docs);
  }

  return doc;
}

export async function restoreVersion(
  id: string,
  versionId: string,
  updatedBy: string = "Anonymous"
): Promise<Document | undefined> {
  const now = new Date().toISOString();

  if (isSupabaseEnabled && supabaseClient) {
    try {
      const doc = await getDocumentById(id);
      if (!doc) return undefined;

      const version = doc.history.find((h) => h.id === versionId);
      if (!version) return undefined;

      // Update doc content
      const { error: docError } = await supabaseClient
        .from("documents")
        .update({
          content: version.content,
          title: version.title,
          updated_at: now,
        })
        .eq("id", id);

      if (docError) throw docError;

      // Insert new version history node representing the restoration
      const newHistId = Math.random().toString(36).substring(2, 11);
      const { error: insHistError } = await supabaseClient.from("document_history").insert({
        id: newHistId,
        document_id: id,
        title: version.title,
        content: version.content,
        updated_at: now,
        updated_by: `${updatedBy} (Restored version from ${new Date(version.updatedAt).toLocaleString()})`,
      });

      if (insHistError) throw insHistError;

      return await getDocumentById(id);
    } catch (e) {
      console.error("Supabase restoreVersion error, falling back to local:", e);
    }
  }

  // Fallback
  const docs = getLocalDocuments();
  const docIndex = docs.findIndex((d) => d.id === id);
  if (docIndex === -1) return undefined;

  const doc = docs[docIndex];
  const version = doc.history.find((h) => h.id === versionId);
  if (!version) return undefined;

  doc.content = version.content;
  doc.title = version.title;
  doc.updatedAt = now;

  doc.history.push({
    id: Math.random().toString(36).substring(2, 11),
    title: doc.title,
    content: doc.content,
    updatedAt: now,
    updatedBy: `${updatedBy} (Restored version from ${new Date(version.updatedAt).toLocaleString()})`,
  });

  docs[docIndex] = doc;
  saveLocalDocuments(docs);
  return doc;
}

export async function deleteDocument(id: string): Promise<boolean> {
  if (isSupabaseEnabled && supabaseClient) {
    try {
      const { error } = await supabaseClient.from("documents").delete().eq("id", id);
      if (error) throw error;
      return true;
    } catch (e) {
      console.error("Supabase deleteDocument error, falling back to local:", e);
    }
  }

  // Fallback
  const docs = getLocalDocuments();
  const filtered = docs.filter((d) => d.id !== id);
  if (filtered.length === docs.length) return false;
  saveLocalDocuments(filtered);
  return true;
}

export async function seedDefaultDocuments(): Promise<void> {
  const docs = await getDocuments();
  if (docs.length === 0) {
    await createDocument(
      "Getting Started with Antigravity Docs",
      `<h1>Welcome to Antigravity Docs!</h1><p>This is a lightweight collaborative document editor inspired by Google Docs.</p><p>Here is what you can do in this app:</p><ul><li><b>Rich Text Formatting</b>: Use the toolbar at the top to format text (bold, italic, underline), set headings, and create bulleted/numbered lists.</li><li><b>Document Outline</b>: Check out the outline panel on the right! It automatically detects headers and lists them for easy navigation.</li><li><b>Collaborative Presences</b>: Switch your active user in the top right to see presence in action, or click "Simulate Co-editor" to spawn Bob, who will start typing on the document in real-time.</li><li><b>Version History</b>: Tweak this document, save, and check the Version History sidebar to restore older drafts!</li></ul><p>Feel free to edit this document or create a brand-new one!</p>`,
      "System"
    );
  }
}

// =============================================================================
// Sharing CRUD
// =============================================================================

export async function getDocumentShares(documentId: string): Promise<DocumentShare[]> {
  if (isSupabaseEnabled && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from("document_shares")
        .select("*")
        .eq("document_id", documentId);
      if (error) throw error;
      return (data || []).map((s: any) => ({
        id: s.id,
        documentId: s.document_id,
        userId: s.user_id,
        permission: s.permission,
        createdAt: s.created_at,
      }));
    } catch (e) {
      console.error("[Supabase] getDocumentShares error, falling back to local:", e);
    }
  }
  // Local fallback — shares stored inline in document
  const docs = getLocalDocuments();
  const doc = docs.find((d) => d.id === documentId);
  return (doc?.shares as DocumentShare[]) || [];
}

export async function shareDocument(
  documentId: string,
  userId: string,
  permission: "view" | "edit"
): Promise<DocumentShare | undefined> {
  if (isSupabaseEnabled && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from("document_shares")
        .insert({ document_id: documentId, user_id: userId, permission })
        .select()
        .single();
      if (error) throw error;
      return {
        id: data.id,
        documentId: data.document_id,
        userId: data.user_id,
        permission: data.permission,
        createdAt: data.created_at,
      };
    } catch (e) {
      console.error("[Supabase] shareDocument error, falling back to local:", e);
    }
  }
  // Local fallback
  const docs = getLocalDocuments();
  const doc = docs.find((d) => d.id === documentId);
  if (!doc) return undefined;
  const newShare: DocumentShare = {
    id: crypto.randomUUID(),
    documentId,
    userId,
    permission,
    createdAt: new Date().toISOString(),
  };
  doc.shares = [...(doc.shares || []), newShare];
  saveLocalDocuments(docs);
  return newShare;
}

export async function unshareDocument(shareId: string): Promise<boolean> {
  if (isSupabaseEnabled && supabaseClient) {
    try {
      const { error } = await supabaseClient
        .from("document_shares")
        .delete()
        .eq("id", shareId);
      if (error) throw error;
    } catch (e) {
      console.error("[Supabase] unshareDocument error, falling back to local:", e);
    }
  }
  // Local fallback
  const docs = getLocalDocuments();
  let changed = false;
  for (const d of docs) {
    const original = (d.shares || []).length;
    d.shares = (d.shares || []).filter((s) => s.id !== shareId);
    if ((d.shares || []).length !== original) changed = true;
  }
  if (changed) saveLocalDocuments(docs);
  return changed;
}

// =============================================================================
// Attachment CRUD
// =============================================================================

export async function createAttachment(
  documentId: string,
  filename: string,
  mimeType: string,
  sizeBytes: number,
  url: string
): Promise<DocumentAttachment | undefined> {
  if (isSupabaseEnabled && supabaseClient) {
    try {
      const { data, error } = await supabaseClient
        .from("document_attachments")
        .insert({ document_id: documentId, filename, mime_type: mimeType, size_bytes: sizeBytes, url })
        .select()
        .single();
      if (error) throw error;
      return {
        id: data.id,
        documentId: data.document_id,
        filename: data.filename,
        mimeType: data.mime_type,
        sizeBytes: Number(data.size_bytes),
        url: data.url,
        uploadedAt: data.uploaded_at,
      };
    } catch (e) {
      console.error("[Supabase] createAttachment error, falling back to local:", e);
    }
  }
  // Local fallback
  const docs = getLocalDocuments();
  const doc = docs.find((d) => d.id === documentId);
  if (!doc) return undefined;
  const attachment: DocumentAttachment = {
    id: crypto.randomUUID(),
    documentId,
    filename,
    mimeType,
    sizeBytes,
    url,
    uploadedAt: new Date().toISOString(),
  };
  doc.attachments = [...(doc.attachments || []), attachment];
  saveLocalDocuments(docs);
  return attachment;
}

