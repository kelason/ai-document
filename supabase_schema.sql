-- Create documents table
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  owner TEXT NOT NULL DEFAULT 'Anonymous'
);

-- Create document history table for version rollback
CREATE TABLE IF NOT EXISTS document_history (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'Anonymous'
);

-- Index for faster history queries
CREATE INDEX IF NOT EXISTS idx_document_history_doc_id ON document_history(document_id);

-- =========================================================
-- IMPORTANT: Disable RLS so the anon key can read/write
-- (This app manages its own auth layer via user profiles)
-- =========================================================
ALTER TABLE documents DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_history DISABLE ROW LEVEL SECURITY;

-- Enable Realtime for the documents and history tables
ALTER PUBLICATION supabase_realtime ADD TABLE documents;
ALTER PUBLICATION supabase_realtime ADD TABLE document_history;

-- Table for document sharing (simple permission model)
CREATE TABLE IF NOT EXISTS document_shares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,                     -- simulated user profile id
  permission TEXT NOT NULL CHECK (permission IN ('view','edit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Table for file attachments linked to a document
CREATE TABLE IF NOT EXISTS document_attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  url TEXT NOT NULL,
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure Row Level Security is disabled for the new tables as well
ALTER TABLE document_shares DISABLE ROW LEVEL SECURITY;
ALTER TABLE document_attachments DISABLE ROW LEVEL SECURITY;

