-- Transaction managed by Supabase. Default deny until the coordinated RLS/auth
-- migration supplies verified-user policies and narrowly scoped client grants.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL CHECK (char_length(email) BETWEEN 3 AND 320),
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 100),
  avatar_url text,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS profiles_email_unique ON public.profiles(lower(email));
CREATE TABLE IF NOT EXISTS public.documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  content text NOT NULL DEFAULT '' CHECK (octet_length(content) <= 1048576),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_owner_updated_idx ON public.documents(owner_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS public.document_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  content text NOT NULL CHECK (octet_length(content) <= 1048576),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS document_history_document_updated_idx ON public.document_history(document_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS public.document_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  permission text NOT NULL CHECK (permission IN ('view','edit')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT document_shares_document_user_unique UNIQUE(document_id, user_id)
);
CREATE INDEX IF NOT EXISTS document_shares_user_idx ON public.document_shares(user_id, document_id);
CREATE TABLE IF NOT EXISTS public.document_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  filename text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  mime_type text NOT NULL CHECK (char_length(mime_type) BETWEEN 1 AND 255),
  size_bytes bigint NOT NULL CHECK (size_bytes BETWEEN 0 AND 5242880),
  url text NOT NULL CHECK (char_length(url) <= 2048),
  uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS document_attachments_document_idx ON public.document_attachments(document_id);
CREATE TABLE IF NOT EXISTS public.document_presence (
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  cursor_x integer CHECK (cursor_x BETWEEN 0 AND 100000),
  cursor_y integer CHECK (cursor_y BETWEEN 0 AND 100000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(document_id, user_id)
);
CREATE INDEX IF NOT EXISTS document_presence_user_idx ON public.document_presence(user_id);
CREATE INDEX IF NOT EXISTS document_presence_updated_idx ON public.document_presence(updated_at);

DO $restrict$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['profiles','documents','document_history','document_shares','document_attachments','document_presence'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', relation_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', relation_name);
  END LOOP;
END
$restrict$;
-- In particular, clients have no INSERT/UPDATE grant on profiles.verified.
-- Verification will be synchronized from auth.users only by trusted SQL code.
-- Realtime is added in the coordinated authorization migration, never here.
