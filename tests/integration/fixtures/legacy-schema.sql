-- Faithful legacy schema fixture: simulated owners and recipient IDs are strings.
CREATE TABLE public.documents (id text PRIMARY KEY, title text NOT NULL,
  content text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(), owner text NOT NULL DEFAULT 'Anonymous');
CREATE TABLE public.document_history (id text PRIMARY KEY,
  document_id text NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  title text NOT NULL, content text NOT NULL, updated_at timestamptz NOT NULL,
  updated_by text NOT NULL DEFAULT 'Anonymous');
CREATE INDEX idx_document_history_doc_id ON public.document_history(document_id);
CREATE TABLE public.document_shares (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id text NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id text NOT NULL, permission text NOT NULL CHECK (permission IN ('view','edit')),
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE public.document_attachments (id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id text NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  filename text NOT NULL, mime_type text NOT NULL, size_bytes bigint NOT NULL,
  url text NOT NULL, uploaded_at timestamptz NOT NULL DEFAULT now());
INSERT INTO public.documents(id,title,content,owner) VALUES
  ('legacy-alice','Original title','<p>Original content</p>','Alice'),
  ('legacy-unclaimed','Unclaimed','<p>Preserve me</p>','Anonymous');
INSERT INTO public.document_history VALUES
  ('legacy-revision','legacy-alice','Old title','<p>Old content</p>','2026-10-01T12:00:00Z','Bob');
INSERT INTO public.document_shares(id,document_id,user_id,permission) VALUES
  ('10000000-0000-0000-0000-000000000001','legacy-alice','charlie','edit');
INSERT INTO public.document_attachments(id,document_id,filename,mime_type,size_bytes,url) VALUES
  ('20000000-0000-0000-0000-000000000001','legacy-alice','notes.txt','text/plain',12,'about:blank');
-- Snapshot every original column and row independently of the archive logic.
CREATE TEMP TABLE expected_legacy_rows (relation_name text PRIMARY KEY, rows jsonb NOT NULL);
INSERT INTO expected_legacy_rows VALUES
  ('documents', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.documents t)),
  ('document_history', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.document_history t)),
  ('document_shares', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.document_shares t)),
  ('document_attachments', (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM public.document_attachments t));
GRANT ALL ON public.documents, public.document_history, public.document_shares,
  public.document_attachments TO anon, authenticated, service_role;
ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY legacy_public_access ON public.documents FOR ALL TO PUBLIC USING (true) WITH CHECK (true);
-- Existing installations may already have Realtime membership.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    CREATE PUBLICATION supabase_realtime;
  END IF;
END $$;
ALTER PUBLICATION supabase_realtime ADD TABLE public.documents, public.document_history;
