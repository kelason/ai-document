-- SQL time is authoritative; every document RPC already enters lock_session.
-- BEGIN GENERATED DEMO FIXTURE
CREATE OR REPLACE FUNCTION temporary_private.demo_fixture() RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $fixture$
 SELECT '{"documents":[{"key":"alice-proposal","owner":"alice","title":"Community Garden Proposal","content":"<h1>Community Garden Proposal</h1><p>Fictional demo by Alice. Help the fictional Maple Lane community grow a shared garden.</p><h2>Plan</h2><ul><li>Build three raised beds.</li><li>Host a weekend planting workshop.</li></ul><table><tr><th>Item</th><th>Demo budget</th></tr><tr><td>Seeds</td><td>120</td></tr><tr><td>Tools</td><td>240</td></tr></table>","history":[{"title":"Community Garden Proposal","content":"<h1>Community Garden Proposal</h1><p>Fictional first draft: a shared space to grow herbs.</p>","updatedBy":"Alice"}],"shares":[{"persona":"bob","permission":"edit"},{"persona":"charlie","permission":"view"}]},{"key":"bob-meeting","owner":"bob","title":"Garden Planning Meeting Notes","content":"<h1>Garden Planning Meeting Notes</h1><p>Fictional demo by Bob.</p><h2>Decisions</h2><ol><li>Choose accessible paths.</li><li>Start with herbs and leafy greens.</li></ol><p><strong>Next step:</strong> Alice drafts the volunteer schedule; Charlie reviews the watering plan.</p>","history":[{"title":"Garden Planning Meeting Notes","content":"<h1>Meeting Agenda</h1><p>Fictional agenda: layout, volunteers, and watering.</p>","updatedBy":"Bob"}],"shares":[{"persona":"alice","permission":"view"},{"persona":"charlie","permission":"edit"}]},{"key":"charlie-specification","owner":"charlie","title":"Garden Watering Specification","content":"<h1>Garden Watering Specification</h1><p>Fictional demo by Charlie.</p><h2>Requirements</h2><ul><li>Use clearly labeled watering zones.</li><li>Record each watering session.</li><li>Provide an accessible manual control.</li></ul><p><em>Review this sample with the other demo personas.</em></p>","history":[{"title":"Garden Watering Specification","content":"<h1>Watering Specification</h1><p>Fictional draft: document the three watering zones.</p>","updatedBy":"Charlie"}],"shares":[{"persona":"alice","permission":"edit"},{"persona":"bob","permission":"view"}]}]}'::jsonb;
$fixture$;
-- END GENERATED DEMO FIXTURE

CREATE OR REPLACE FUNCTION temporary_private.seed_demo(p_workspace_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w temporary_private.workspaces; doc jsonb; revision jsonb; share jsonb; doc_id uuid; item integer;
BEGIN
 SELECT * INTO w FROM temporary_private.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR w.kind<>'demo' THEN RETURN; END IF;
 FOR doc IN SELECT value FROM jsonb_array_elements(temporary_private.demo_fixture()->'documents') LOOP
  doc_id:=md5(w.id::text||':'||w.generation::text||':'||(doc->>'key'))::uuid;
  INSERT INTO temporary_private.documents(id,workspace_id,owner_persona,title,content)
   VALUES(doc_id,w.id,doc->>'owner',doc->>'title',doc->>'content') ON CONFLICT(id) DO NOTHING;
  item:=0;
  FOR revision IN SELECT value FROM jsonb_array_elements(doc->'history') LOOP
   item:=item+1;
   INSERT INTO temporary_private.history(id,document_id,title,content,updated_by)
    VALUES(md5(doc_id::text||':history:'||item::text)::uuid,doc_id,revision->>'title',revision->>'content',revision->>'updatedBy') ON CONFLICT(id) DO NOTHING;
  END LOOP;
  FOR share IN SELECT value FROM jsonb_array_elements(doc->'shares') LOOP
   INSERT INTO temporary_private.shares(id,document_id,persona,permission)
    VALUES(md5(doc_id::text||':share:'||(share->>'persona'))::uuid,doc_id,share->>'persona',share->>'permission') ON CONFLICT(document_id,persona) DO NOTHING;
  END LOOP;
 END LOOP;
END $$;

-- Caller locks workspace first. Reentrant locking keeps all entry points safe.
CREATE FUNCTION temporary_private.reset_workspace(p_workspace_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w temporary_private.workspaces; t timestamptz;
BEGIN
 SELECT * INTO w FROM temporary_private.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR w.kind<>'demo' THEN RETURN false; END IF;
 t:=clock_timestamp();
 IF w.reset_at>t THEN RETURN false; END IF;
 DELETE FROM temporary_private.documents WHERE workspace_id=w.id;
 UPDATE temporary_private.workspaces SET generation=generation+1,
  reset_at=((t AT TIME ZONE 'Asia/Manila')::date+1)::timestamp AT TIME ZONE 'Asia/Manila' WHERE id=w.id;
 PERFORM temporary_private.seed_demo(w.id);
 RETURN true;
END $$;

CREATE OR REPLACE FUNCTION temporary_private.lock_session(p_token_hash text,p_expected_generation integer DEFAULT NULL)
RETURNS temporary_private.sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s temporary_private.sessions; w temporary_private.workspaces; t timestamptz;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 SELECT w0.* INTO w FROM temporary_private.workspaces w0 JOIN temporary_private.sessions s0 ON s0.workspace_id=w0.id WHERE s0.token_hash=p_token_hash FOR UPDATE OF w0;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 SELECT * INTO s FROM temporary_private.sessions WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 t:=clock_timestamp();
 IF s.expires_at<=t OR (w.kind='guest' AND w.expires_at<=t) OR (w.kind='demo' AND s.last_active_at<=t-interval '24 hours') THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 IF w.kind='demo' AND w.reset_at<=t THEN
  -- Raising after a reset would roll the reset back. A stale operation fails
  -- immediately; metadata refresh (NULL expected generation) or cron commits it.
  IF p_expected_generation IS NOT NULL THEN RAISE EXCEPTION 'DEMO_RESET'; END IF;
  PERFORM temporary_private.reset_workspace(w.id);
  SELECT * INTO w FROM temporary_private.workspaces WHERE id=w.id;
 END IF;
 IF p_expected_generation IS NOT NULL AND p_expected_generation<>w.generation THEN RAISE EXCEPTION 'DEMO_RESET'; END IF;
 UPDATE temporary_private.sessions SET last_active_at=t,expires_at=CASE WHEN w.kind='demo' THEN t+interval '24 hours' ELSE expires_at END WHERE id=s.id RETURNING * INTO s;
 RETURN s;
END $$;

CREATE FUNCTION public.ensure_demo_generation(p_token_hash text,p_expected_generation integer DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s temporary_private.sessions;
BEGIN
 s:=temporary_private.lock_session(p_token_hash,p_expected_generation);
 RETURN temporary_private.session_json(s);
END $$;

CREATE TABLE temporary_private.maintenance_runs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 job_name text NOT NULL CHECK(job_name IN ('purge','reset')),
 finished_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 affected_workspaces integer NOT NULL
);
ALTER TABLE temporary_private.maintenance_runs ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION public.purge_expired_workspaces() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w temporary_private.workspaces; s temporary_private.sessions; t timestamptz; removed integer:=0;
BEGIN
 FOR w IN SELECT w0.* FROM temporary_private.workspaces w0 WHERE
  (w0.kind='guest' AND w0.expires_at<=clock_timestamp()) OR EXISTS(
    SELECT 1 FROM temporary_private.sessions s0 WHERE s0.workspace_id=w0.id AND (s0.expires_at<=clock_timestamp() OR (w0.kind='demo' AND s0.last_active_at<=clock_timestamp()-interval '24 hours')))
  ORDER BY w0.id FOR UPDATE OF w0 SKIP LOCKED LOOP
  SELECT * INTO s FROM temporary_private.sessions WHERE workspace_id=w.id FOR UPDATE;
  t:=clock_timestamp();
  IF (w.kind='guest' AND w.expires_at<=t) OR s.expires_at<=t OR (w.kind='demo' AND s.last_active_at<=t-interval '24 hours') THEN
   DELETE FROM temporary_private.workspaces WHERE id=w.id;
   removed:=removed+1;
  END IF;
 END LOOP;
 DELETE FROM temporary_private.maintenance_runs WHERE finished_at<clock_timestamp()-interval '30 days';
 INSERT INTO temporary_private.maintenance_runs(job_name,affected_workspaces) VALUES('purge',removed);
 RETURN removed;
END $$;

CREATE FUNCTION public.reset_due_demos() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w temporary_private.workspaces; s temporary_private.sessions; t timestamptz; resets integer:=0;
BEGIN
 FOR w IN SELECT * FROM temporary_private.workspaces WHERE kind='demo' AND reset_at<=clock_timestamp() ORDER BY id FOR UPDATE SKIP LOCKED LOOP
  SELECT * INTO s FROM temporary_private.sessions WHERE workspace_id=w.id FOR UPDATE;
  t:=clock_timestamp();
  IF s.expires_at>t AND s.last_active_at>t-interval '24 hours' AND temporary_private.reset_workspace(w.id) THEN resets:=resets+1; END IF;
 END LOOP;
 INSERT INTO temporary_private.maintenance_runs(job_name,affected_workspaces) VALUES('reset',resets);
 RETURN resets;
END $$;

-- Capture the generation when a write happens, then validate again at commit.
-- One event per workspace/generation bounds overhead. No public bypass flag:
-- cleanup/claim is exempt only once the workspace no longer exists, and a reset
-- exempts old events only once it has actually replaced their generation.
CREATE TABLE temporary_private.write_checks (
 workspace_id uuid NOT NULL REFERENCES temporary_private.workspaces(id) ON DELETE CASCADE,
 generation integer NOT NULL,
 PRIMARY KEY(workspace_id,generation)
);
ALTER TABLE temporary_private.write_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE temporary_private.write_checks FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION temporary_private.capture_write_generation() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE workspace uuid; document uuid;
BEGIN
 IF TG_TABLE_NAME='documents' THEN
  IF TG_OP='DELETE' THEN workspace:=OLD.workspace_id; ELSE workspace:=NEW.workspace_id; END IF;
 ELSE
  IF TG_OP='DELETE' THEN document:=OLD.document_id; ELSE document:=NEW.document_id; END IF;
  SELECT workspace_id INTO workspace FROM temporary_private.documents WHERE id=document;
 END IF;
 INSERT INTO temporary_private.write_checks(workspace_id,generation)
  SELECT id,generation FROM temporary_private.workspaces WHERE id=workspace
  ON CONFLICT(workspace_id,generation) DO NOTHING;
 RETURN NULL;
END $$;

CREATE FUNCTION temporary_private.check_write_deadline() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w temporary_private.workspaces; s temporary_private.sessions; t timestamptz;
BEGIN
 SELECT * INTO w FROM temporary_private.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 IF FOUND AND w.generation=NEW.generation THEN
  SELECT * INTO s FROM temporary_private.sessions WHERE workspace_id=w.id FOR UPDATE;
  t:=clock_timestamp();
  IF (w.kind='guest' AND w.expires_at<=t) OR s.expires_at<=t OR (w.kind='demo' AND s.last_active_at<=t-interval '24 hours') THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
  IF w.kind='demo' AND w.reset_at<=t THEN RAISE EXCEPTION 'DEMO_RESET'; END IF;
 END IF;
 DELETE FROM temporary_private.write_checks WHERE workspace_id=NEW.workspace_id AND generation=NEW.generation;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER temporary_write_deadline AFTER INSERT ON temporary_private.write_checks
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION temporary_private.check_write_deadline();
CREATE TRIGGER capture_document_write AFTER INSERT OR UPDATE OR DELETE ON temporary_private.documents FOR EACH ROW EXECUTE FUNCTION temporary_private.capture_write_generation();
CREATE TRIGGER capture_history_write AFTER INSERT OR UPDATE OR DELETE ON temporary_private.history FOR EACH ROW EXECUTE FUNCTION temporary_private.capture_write_generation();
CREATE TRIGGER capture_share_write AFTER INSERT OR UPDATE OR DELETE ON temporary_private.shares FOR EACH ROW EXECUTE FUNCTION temporary_private.capture_write_generation();
CREATE TRIGGER capture_attachment_write AFTER INSERT OR UPDATE OR DELETE ON temporary_private.attachments FOR EACH ROW EXECUTE FUNCTION temporary_private.capture_write_generation();
CREATE TRIGGER capture_presence_write AFTER INSERT OR UPDATE OR DELETE ON temporary_private.presence FOR EACH ROW EXECUTE FUNCTION temporary_private.capture_write_generation();

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA temporary_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON TABLE temporary_private.maintenance_runs FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.ensure_demo_generation(text,integer), public.purge_expired_workspaces(), public.reset_due_demos() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_demo_generation(text,integer), public.purge_expired_workspaces(), public.reset_due_demos() TO service_role;

CREATE EXTENSION IF NOT EXISTS pg_cron;
-- Cron's scheduler timezone is independent of a SQL session's TimeZone.
-- Refuse deployment with a non-UTC scheduler instead of silently shifting PHT.
DO $cron_settings$
BEGIN
 IF coalesce(current_setting('cron.timezone',true),'GMT') NOT IN ('GMT','UTC','Etc/UTC') THEN RAISE EXCEPTION 'pg_cron timezone must be UTC'; END IF;
 IF coalesce(current_setting('cron.log_run',true),'on')<>'on' THEN RAISE EXCEPTION 'pg_cron run logging must be enabled'; END IF;
END $cron_settings$;
-- Named schedule upserts are idempotent. cron.job_run_details records status,
-- return_message and timestamps for failures; maintenance_runs records success
-- counts. Administrators should alert on failed runs and >2 minute cleanup lag.
SELECT cron.schedule('ai-docs-expiry-minute','* * * * *','SELECT public.purge_expired_workspaces();');
SELECT cron.schedule('ai-docs-demo-midnight','0 16 * * *','SELECT public.reset_due_demos();');
