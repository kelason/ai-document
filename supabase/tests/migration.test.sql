BEGIN;
SELECT plan(13);
SELECT has_schema('legacy_archive', 'Private archive schema exists');
SELECT ok(NOT has_schema_privilege('anon','legacy_archive','USAGE'), 'Anonymous cannot use archive');
SELECT ok(NOT has_schema_privilege('authenticated','legacy_archive','USAGE'), 'Authenticated clients cannot use archive');
SELECT ok(NOT has_schema_privilege('service_role','legacy_archive','USAGE'), 'Routine service role cannot use archive');
SELECT is((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='id'), 'uuid', 'Persistent documents use UUID IDs');
SELECT is((SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='documents' AND column_name='owner_id'), 'uuid', 'Persistent owners use immutable UUIDs');
SELECT ok(NOT has_column_privilege('authenticated','public.profiles','verified','UPDATE'), 'Clients cannot mark profiles verified');
SELECT ok(c.relrowsecurity, c.relname || ' has RLS enabled') FROM pg_class c
  JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
  AND c.relname IN ('profiles','documents','document_history','document_shares','document_attachments','document_presence') ORDER BY c.relname;
SELECT * FROM finish();
ROLLBACK;
