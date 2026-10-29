-- Run by the Supabase migration runner in one transaction. Never serve via HTTP.
-- Move, rather than copy/delete: original IDs, columns, FK relationships and
-- records remain intact. No simulated name is evidence of account ownership.
CREATE SCHEMA IF NOT EXISTS legacy_archive AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA legacy_archive FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA legacy_archive REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA legacy_archive REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA legacy_archive REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;
CREATE TABLE IF NOT EXISTS legacy_archive.migration_log (
  migration_id text PRIMARY KEY,
  archived_at timestamptz NOT NULL DEFAULT now(),
  table_counts jsonb NOT NULL
);
REVOKE ALL ON legacy_archive.migration_log FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE legacy_archive.migration_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE legacy_archive.migration_log FORCE ROW LEVEL SECURITY;

DO $archive$
DECLARE
  relation_name text;
  publication_name text;
  policy_name text;
  relation_oid oid;
  row_count bigint;
  counts jsonb := '{}'::jsonb;
BEGIN
  -- Manual replay cannot re-archive newly created persistent tables.
  IF EXISTS (SELECT 1 FROM legacy_archive.migration_log WHERE migration_id = '202610270001') THEN RETURN; END IF;
  IF to_regclass('public.documents') IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='documents' AND column_name='owner' AND data_type='text'
  ) THEN
    RAISE EXCEPTION 'Unknown documents schema: review the upgrade before proceeding';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication WHERE puballtables) THEN
    RAISE EXCEPTION 'All-table publication would expose archived data; operator review required';
  END IF;
  FOREACH relation_name IN ARRAY ARRAY['documents','document_history','document_shares','document_attachments','document_presence'] LOOP
    relation_oid := to_regclass(format('public.%I', relation_name));
    IF relation_oid IS NULL THEN CONTINUE; END IF;
    IF to_regclass(format('legacy_archive.%I', relation_name)) IS NOT NULL THEN
      RAISE EXCEPTION 'Archive collision for %; refusing to overwrite data', relation_name;
    END IF;
    -- An existing view could expose a moved table through its owner's rights.
    -- Fail closed instead of deleting unrecognized database objects.
    IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON r.oid=d.objid
      JOIN pg_class v ON v.oid=r.ev_class
      WHERE d.refobjid=relation_oid AND v.relkind IN ('v','m')) THEN
      RAISE EXCEPTION 'Dependent view for % requires administrator review', relation_name;
    END IF;
    EXECUTE format('LOCK TABLE public.%I IN ACCESS EXCLUSIVE MODE', relation_name);
    EXECUTE format('SELECT count(*) FROM public.%I', relation_name) INTO row_count;
    counts := counts || jsonb_build_object(relation_name, row_count);
    FOR publication_name IN SELECT p.pubname FROM pg_publication p
      JOIN pg_publication_rel pr ON pr.prpubid=p.oid WHERE pr.prrelid=relation_oid LOOP
      EXECUTE format('ALTER PUBLICATION %I DROP TABLE public.%I', publication_name, relation_name);
    END LOOP;
    EXECUTE format('ALTER TABLE public.%I SET SCHEMA legacy_archive', relation_name);
    EXECUTE format('ALTER TABLE legacy_archive.%I OWNER TO postgres', relation_name);
    EXECUTE format('REVOKE ALL ON TABLE legacy_archive.%I FROM PUBLIC, anon, authenticated, service_role', relation_name);
    EXECUTE format('ALTER TABLE legacy_archive.%I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE legacy_archive.%I FORCE ROW LEVEL SECURITY', relation_name);
    FOR policy_name IN SELECT polname FROM pg_policy WHERE polrelid=relation_oid LOOP
      EXECUTE format('DROP POLICY %I ON legacy_archive.%I', policy_name, relation_name);
    END LOOP;
  END LOOP;
  INSERT INTO legacy_archive.migration_log(migration_id, table_counts) VALUES ('202610270001', counts);
END
$archive$;
REVOKE ALL ON ALL TABLES IN SCHEMA legacy_archive FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA legacy_archive FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA legacy_archive FROM PUBLIC, anon, authenticated, service_role;
