-- Administrator-only, read-only target verification. No document contents,
-- cookie hashes, keys, credentials or email addresses are returned.
BEGIN READ ONLY;
DO $check$
DECLARE role_name text; table_name text; schema_name text; n integer;
BEGIN
 IF to_regclass('supabase_migrations.schema_migrations') IS NULL THEN RAISE EXCEPTION 'Migration registry is missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='202610270009') THEN RAISE EXCEPTION 'Required migration0009 is missing'; END IF;
 IF to_regclass('legacy_archive.migration_log') IS NULL THEN RAISE EXCEPTION 'Legacy archive migration is missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM legacy_archive.migration_log WHERE migration_id='202610270001') THEN RAISE EXCEPTION 'Legacy archive migration record is missing'; END IF;
 FOREACH schema_name IN ARRAY ARRAY['legacy_archive','temporary_private'] LOOP
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
   IF has_schema_privilege(role_name,schema_name,'USAGE') THEN RAISE EXCEPTION 'Private schema is accessible to an application role'; END IF;
  END LOOP;
 END LOOP;
 FOREACH table_name IN ARRAY ARRAY['profiles','documents','document_history','document_shares','document_attachments','document_presence'] LOOP
  IF NOT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid=c.relnamespace WHERE ns.nspname='public' AND c.relname=table_name AND c.relrowsecurity) THEN RAISE EXCEPTION 'Persistent RLS is missing'; END IF;
 END LOOP;
 IF has_table_privilege('anon','public.documents','SELECT') OR has_table_privilege('authenticated','public.documents','INSERT') OR has_table_privilege('authenticated','public.documents','UPDATE') THEN RAISE EXCEPTION 'Unsafe persistent grants'; END IF;
 IF has_column_privilege('authenticated','public.profiles','email','SELECT') OR has_column_privilege('authenticated','public.profiles','verified','UPDATE') THEN RAISE EXCEPTION 'Unsafe profile column grants'; END IF;
 IF has_function_privilege('authenticated','public.prepare_guest_claim(uuid,text)','EXECUTE') OR has_function_privilege('anon','public.temporary_start(text,text,text)','EXECUTE') THEN RAISE EXCEPTION 'Privileged temporary RPC exposed'; END IF;
 IF NOT has_function_privilege('service_role','public.claim_guest_workspace(uuid,text,text,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'Guest claim service grant is missing'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='claim_commit_deadline' AND NOT tgisinternal AND tgdeferrable AND tginitdeferred) OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgname='temporary_write_deadline' AND NOT tgisinternal AND tgdeferrable AND tginitdeferred) THEN RAISE EXCEPTION 'Deferred deadline guard is missing'; END IF;
 IF coalesce(current_setting('cron.timezone',true),'GMT') NOT IN ('GMT','UTC','Etc/UTC') OR coalesce(current_setting('cron.log_run',true),'on')<>'on' THEN RAISE EXCEPTION 'Cron must use UTC and execution logging'; END IF;
 SELECT count(*) INTO n FROM cron.job WHERE active AND ((jobname='ai-docs-expiry-minute' AND schedule='* * * * *' AND command='SELECT public.purge_expired_workspaces();') OR (jobname='ai-docs-demo-midnight' AND schedule='0 16 * * *' AND command='SELECT public.reset_due_demos();') OR (jobname='ai-docs-claim-receipt-retention' AND schedule='* * * * *' AND command='SELECT public.purge_guest_claim_receipts();'));
 IF n<>3 THEN RAISE EXCEPTION 'Temporary lifecycle schedules are missing or changed'; END IF;
 IF NOT EXISTS(SELECT 1 FROM cron.job WHERE active AND jobname='ai-docs-request-limit-retention') THEN RAISE EXCEPTION 'Rate-limit retention job is missing'; END IF;
 IF EXISTS(SELECT 1 FROM cron.job j JOIN LATERAL (SELECT status FROM cron.job_run_details d WHERE d.jobid=j.jobid ORDER BY start_time DESC LIMIT 1) latest ON true WHERE j.jobname LIKE 'ai-docs-%' AND latest.status='failed') THEN RAISE EXCEPTION 'An AI Docs maintenance job last failed'; END IF;
END $check$;
SELECT 'Database deployment checks passed. Verify external Auth/SMTP/ingress, exposed API schemas, maintenance health, backup and hosting configuration separately.' AS result;
ROLLBACK;
