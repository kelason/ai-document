DO $$
DECLARE table_name text;
BEGIN
  IF (SELECT count(*) FROM public.documents) <> 0 OR (SELECT count(*) FROM public.profiles) <> 0 THEN
    RAISE EXCEPTION 'Fresh schema must not infer persistent accounts or documents';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['profiles','documents','document_history','document_shares','document_attachments','document_presence'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = table_name AND c.relrowsecurity) THEN
      RAISE EXCEPTION 'RLS missing for %', table_name;
    END IF;
    IF has_table_privilege('anon', 'public.' || table_name, 'SELECT') OR
       has_table_privilege('authenticated', 'public.' || table_name, 'INSERT') THEN
      RAISE EXCEPTION 'Task 2 must default deny client access to %', table_name;
    END IF;
  END LOOP;
END $$;
