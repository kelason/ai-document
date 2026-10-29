DO $$
DECLARE
  archived_count bigint;
  expected record;
  archived_rows jsonb;
BEGIN
  FOR expected IN SELECT * FROM expected_legacy_rows LOOP
    EXECUTE format('SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM legacy_archive.%I t', expected.relation_name) INTO archived_rows;
    IF archived_rows IS DISTINCT FROM expected.rows THEN
      RAISE EXCEPTION 'Original rows/columns changed for %', expected.relation_name;
    END IF;
  END LOOP;
  SELECT count(*) INTO archived_count FROM legacy_archive.documents;
  IF archived_count <> 2 THEN RAISE EXCEPTION 'Archive count differs from legacy count: %', archived_count; END IF;
  IF NOT EXISTS (SELECT 1 FROM legacy_archive.documents WHERE id='legacy-alice' AND owner='Alice'
    AND title='Original title' AND content='<p>Original content</p>') THEN RAISE EXCEPTION 'Document data changed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM legacy_archive.document_history WHERE id='legacy-revision'
    AND document_id='legacy-alice' AND updated_by='Bob' AND content='<p>Old content</p>') THEN RAISE EXCEPTION 'History lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM legacy_archive.document_shares WHERE document_id='legacy-alice'
    AND user_id='charlie' AND permission='edit') THEN RAISE EXCEPTION 'Shares lost'; END IF;
  IF NOT EXISTS (SELECT 1 FROM legacy_archive.document_attachments WHERE document_id='legacy-alice'
    AND filename='notes.txt' AND size_bytes=12 AND url='about:blank') THEN RAISE EXCEPTION 'Attachment lost'; END IF;
  IF EXISTS (SELECT 1 FROM public.documents) OR EXISTS (SELECT 1 FROM public.profiles) THEN
    RAISE EXCEPTION 'Legacy owner was guessed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='legacy_archive') THEN
    RAISE EXCEPTION 'Archive is still published';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid
    JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='legacy_archive') THEN
    RAISE EXCEPTION 'Legacy permissive policy survived';
  END IF;
  IF (SELECT count(*) FROM legacy_archive.migration_log) <> 1 OR
    (SELECT table_counts FROM legacy_archive.migration_log WHERE migration_id='202610270001')
      IS DISTINCT FROM '{"documents":2,"document_history":1,"document_shares":1,"document_attachments":1}'::jsonb THEN
    RAISE EXCEPTION 'Archive replay duplicated or overwrote migration provenance';
  END IF;
  IF has_schema_privilege('anon','legacy_archive','USAGE') OR
     has_schema_privilege('authenticated','legacy_archive','USAGE') OR
     has_table_privilege('service_role','legacy_archive.documents','SELECT') THEN
    RAISE EXCEPTION 'Archive is not administrator-only';
  END IF;
END $$;
SET LOCAL ROLE anon;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM legacy_archive.documents;
    RAISE EXCEPTION 'Anonymous archive SELECT succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM legacy_archive.documents;
    RAISE EXCEPTION 'Authenticated archive SELECT succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
SET LOCAL ROLE service_role;
DO $$ BEGIN
  BEGIN
    PERFORM * FROM legacy_archive.documents;
    RAISE EXCEPTION 'Service-role archive SELECT succeeded';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
