-- Deterministic custom UUIDv8 identifiers: retain idempotent per-workspace /
-- generation fixtures while setting RFC9562 version and variant bits. A raw
-- MD5::uuid is a PostgreSQL UUID but need not satisfy the HTTP UUID contract.
CREATE FUNCTION temporary_private.fixture_uuid(p_value text) RETURNS uuid
LANGUAGE sql IMMUTABLE STRICT SET search_path='' AS $$
 SELECT (substr(h,1,8)||'-'||substr(h,9,4)||'-8'||substr(h,14,3)||'-8'||substr(h,18,3)||'-'||substr(h,21,12))::uuid FROM (SELECT md5(p_value) AS h) digest;
$$;
REVOKE ALL ON FUNCTION temporary_private.fixture_uuid(text) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION temporary_private.seed_demo(p_workspace_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w temporary_private.workspaces; doc jsonb; revision jsonb; share jsonb; doc_id uuid; item integer;
BEGIN
 SELECT * INTO w FROM temporary_private.workspaces WHERE id=p_workspace_id FOR UPDATE;
 IF NOT FOUND OR w.kind<>'demo' THEN RETURN; END IF;
 FOR doc IN SELECT value FROM jsonb_array_elements(temporary_private.demo_fixture()->'documents') LOOP
  doc_id:=temporary_private.fixture_uuid(w.id::text||':'||w.generation::text||':'||(doc->>'key'));
  INSERT INTO temporary_private.documents(id,workspace_id,owner_persona,title,content)
   VALUES(doc_id,w.id,doc->>'owner',doc->>'title',doc->>'content') ON CONFLICT(id) DO NOTHING;
  item:=0;
  FOR revision IN SELECT value FROM jsonb_array_elements(doc->'history') LOOP
   item:=item+1;
   INSERT INTO temporary_private.history(id,document_id,title,content,updated_by)
    VALUES(temporary_private.fixture_uuid(doc_id::text||':history:'||item::text),doc_id,revision->>'title',revision->>'content',revision->>'updatedBy') ON CONFLICT(id) DO NOTHING;
  END LOOP;
  FOR share IN SELECT value FROM jsonb_array_elements(doc->'shares') LOOP
   INSERT INTO temporary_private.shares(id,document_id,persona,permission)
    VALUES(temporary_private.fixture_uuid(doc_id::text||':share:'||(share->>'persona')),doc_id,share->>'persona',share->>'permission') ON CONFLICT(document_id,persona) DO NOTHING;
  END LOOP;
 END LOOP;
END $$;

-- Repair any active preview workspaces made by the unreleased fixture code.
-- Personal accounts and guests are excluded. This is an ordinary demo reset,
-- so stale clients see a generation change rather than silently wrong IDs.
DO $repair$
DECLARE workspace uuid;
BEGIN
 FOR workspace IN SELECT w.id FROM temporary_private.workspaces w JOIN temporary_private.sessions s ON s.workspace_id=w.id
  WHERE w.kind='demo' AND s.expires_at>clock_timestamp() AND s.last_active_at>clock_timestamp()-interval '24 hours'
  AND EXISTS(SELECT 1 FROM (
   SELECT d.id FROM temporary_private.documents d WHERE d.workspace_id=w.id
   UNION ALL SELECT h.id FROM temporary_private.history h JOIN temporary_private.documents d ON d.id=h.document_id WHERE d.workspace_id=w.id
   UNION ALL SELECT sh.id FROM temporary_private.shares sh JOIN temporary_private.documents d ON d.id=sh.document_id WHERE d.workspace_id=w.id
  ) identifiers WHERE id::text!~'^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$')
  ORDER BY w.id FOR UPDATE OF w
 LOOP
  UPDATE temporary_private.workspaces SET reset_at=clock_timestamp() WHERE id=workspace;
  PERFORM temporary_private.reset_workspace(workspace);
 END LOOP;
END $repair$;
