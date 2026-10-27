-- Temporary data has no foreign keys or query paths into persistent user data.
CREATE SCHEMA temporary_private;
REVOKE ALL ON SCHEMA temporary_private FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA temporary_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA temporary_private REVOKE ALL ON TABLES FROM PUBLIC;

CREATE TABLE temporary_private.workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK (kind IN ('guest','demo')),
 generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz,
 reset_at timestamptz,
 CHECK ((kind='guest' AND expires_at IS NOT NULL AND reset_at IS NULL) OR (kind='demo' AND expires_at IS NULL AND reset_at IS NOT NULL))
);
CREATE TABLE temporary_private.sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL UNIQUE REFERENCES temporary_private.workspaces(id) ON DELETE CASCADE,
 token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[a-f0-9]{64}$'),
 persona text CHECK (persona IN ('alice','bob','charlie')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_active_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL
);
CREATE TABLE temporary_private.documents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES temporary_private.workspaces(id) ON DELETE CASCADE,
 owner_persona text CHECK (owner_persona IN ('alice','bob','charlie')),
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
 content text NOT NULL CHECK (octet_length(content)<=1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE (workspace_id,id)
);
CREATE TABLE temporary_private.history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES temporary_private.documents(id) ON DELETE CASCADE,
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
 content text NOT NULL CHECK (octet_length(content)<=1048576),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_by text NOT NULL
);
CREATE TABLE temporary_private.shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES temporary_private.documents(id) ON DELETE CASCADE,
 persona text NOT NULL CHECK (persona IN ('alice','bob','charlie')),
 permission text NOT NULL CHECK (permission IN ('view','edit')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(document_id,persona)
);
CREATE TABLE temporary_private.attachments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES temporary_private.documents(id) ON DELETE CASCADE,
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 255),
 mime_type text NOT NULL CHECK(length(mime_type) BETWEEN 1 AND 255),
 size_bytes integer NOT NULL CHECK(size_bytes BETWEEN 0 AND 5242880),
 url text NOT NULL CHECK(length(url)<=2048 AND url ~ '^/attachments/[a-f0-9-]+$'),
 uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE temporary_private.presence (
 document_id uuid NOT NULL REFERENCES temporary_private.documents(id) ON DELETE CASCADE,
 identity text NOT NULL CHECK(identity IN ('guest','alice','bob','charlie')),
 cursor_offset integer CHECK(cursor_offset BETWEEN 0 AND 10000000),
 cursor_y double precision CHECK(cursor_y BETWEEN -1000000 AND 1000000),
 last_active_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(document_id,identity)
);
CREATE INDEX temporary_history_document_idx ON temporary_private.history(document_id,updated_at DESC);
CREATE INDEX temporary_documents_workspace_idx ON temporary_private.documents(workspace_id);
CREATE INDEX temporary_sessions_expiry_idx ON temporary_private.sessions(expires_at);
CREATE INDEX temporary_workspace_expiry_idx ON temporary_private.workspaces(expires_at);
CREATE INDEX temporary_workspace_reset_idx ON temporary_private.workspaces(reset_at);

-- Task 7 replaces this extension point with deterministic fixtures for all personas.
CREATE FUNCTION temporary_private.seed_demo(p_workspace_id uuid) RETURNS void
LANGUAGE plpgsql SET search_path='' AS $$ BEGIN RETURN; END $$;

-- Lock order is always workspace, then session. Fresh time is sampled AFTER lock
-- acquisition, so a request queued before expiry cannot write after the boundary.
-- Task 7 extends this helper with atomic reset before checking expected generation.
CREATE FUNCTION temporary_private.lock_session(p_token_hash text,p_expected_generation integer DEFAULT NULL)
RETURNS temporary_private.sessions LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s temporary_private.sessions; w temporary_private.workspaces; t timestamptz;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 SELECT w0.* INTO w FROM temporary_private.workspaces w0 JOIN temporary_private.sessions s0 ON s0.workspace_id=w0.id WHERE s0.token_hash=p_token_hash FOR UPDATE OF w0;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 SELECT * INTO s FROM temporary_private.sessions WHERE token_hash=p_token_hash FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 t:=clock_timestamp();
 IF s.expires_at<=t OR (w.kind='guest' AND w.expires_at<=t) THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 IF w.kind='demo' AND w.reset_at<=t THEN RAISE EXCEPTION 'DEMO_RESET'; END IF;
 IF p_expected_generation IS NOT NULL AND p_expected_generation<>w.generation THEN RAISE EXCEPTION 'DEMO_RESET'; END IF;
 UPDATE temporary_private.sessions SET last_active_at=t,expires_at=CASE WHEN w.kind='demo' THEN t+interval '24 hours' ELSE expires_at END WHERE id=s.id RETURNING * INTO s;
 RETURN s;
END $$;

CREATE FUNCTION temporary_private.session_json(s temporary_private.sessions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('kind',w.kind,'workspaceId',w.id,'sessionId',s.id,'generation',w.generation,'expiresAt',CASE WHEN w.kind='demo' THEN w.reset_at ELSE w.expires_at END,'persona',s.persona)) FROM temporary_private.workspaces w WHERE w.id=s.workspace_id;
$$;
CREATE FUNCTION temporary_private.document_role(s temporary_private.sessions,d temporary_private.documents) RETURNS text
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT CASE WHEN d.workspace_id<>s.workspace_id THEN NULL WHEN d.owner_persona IS NOT DISTINCT FROM s.persona THEN 'owner'
 ELSE (SELECT CASE WHEN sh.permission='edit' THEN 'editor' ELSE 'viewer' END FROM temporary_private.shares sh WHERE sh.document_id=d.id AND sh.persona=s.persona) END;
$$;
CREATE FUNCTION temporary_private.share_json(s temporary_private.shares) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT jsonb_build_object('id',s.id,'documentId',s.document_id,'recipient',jsonb_build_object('persona',s.persona),'permission',s.permission,'createdAt',s.created_at); $$;
CREATE FUNCTION temporary_private.attachment_json(a temporary_private.attachments) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$ SELECT jsonb_build_object('id',a.id,'documentId',a.document_id,'filename',a.filename,'mimeType',a.mime_type,'sizeBytes',a.size_bytes,'url',a.url,'uploadedAt',a.uploaded_at); $$;
CREATE FUNCTION temporary_private.document_json(s temporary_private.sessions,d temporary_private.documents,p_detail boolean DEFAULT true) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path='' AS $$
DECLARE result jsonb; role text:=temporary_private.document_role(s,d); metadata jsonb:=temporary_private.session_json(s);
BEGIN
 IF role IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
 result:=jsonb_strip_nulls(jsonb_build_object('id',d.id,'title',d.title,'createdAt',d.created_at,'updatedAt',d.updated_at,'owner',CASE WHEN d.owner_persona IS NULL THEN 'Guest' ELSE initcap(d.owner_persona) END,'ownerPersona',d.owner_persona,
  'permissions',jsonb_build_object('role',role,'allowedOperations',CASE WHEN role='owner' AND s.persona IS NOT NULL THEN '["read","edit","upload","restore","delete","manage-shares","presence"]'::jsonb WHEN role='owner' THEN '["read","edit","upload","restore","delete","presence"]'::jsonb WHEN role='editor' THEN '["read","edit","upload","restore","presence"]'::jsonb ELSE '["read","presence"]'::jsonb END),
  'session',jsonb_build_object('kind',metadata->'kind','generation',metadata->'generation','expiresAt',metadata->'expiresAt')));
 IF p_detail THEN
  result:=result||jsonb_build_object('content',d.content,
   'history',COALESCE((SELECT jsonb_agg(jsonb_build_object('id',h.id,'title',h.title,'content',h.content,'updatedAt',h.updated_at,'updatedBy',h.updated_by) ORDER BY h.updated_at DESC,h.id DESC) FROM temporary_private.history h WHERE h.document_id=d.id),'[]'::jsonb),
   'shares',COALESCE((SELECT jsonb_agg(temporary_private.share_json(sh) ORDER BY sh.created_at,sh.id) FROM temporary_private.shares sh WHERE sh.document_id=d.id),'[]'::jsonb),
   'attachments',COALESCE((SELECT jsonb_agg(temporary_private.attachment_json(a) ORDER BY a.uploaded_at,a.id) FROM temporary_private.attachments a WHERE a.document_id=d.id),'[]'::jsonb));
 END IF;
 RETURN result;
END $$;

CREATE FUNCTION public.temporary_start(p_token_hash text,p_kind text,p_persona text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w temporary_private.workspaces; s temporary_private.sessions; t timestamptz:=clock_timestamp();
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' OR p_kind IS NULL OR p_kind NOT IN ('guest','demo') OR (p_kind='guest' AND p_persona IS NOT NULL) OR (p_kind='demo' AND (p_persona IS NULL OR p_persona NOT IN ('alice','bob','charlie'))) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 INSERT INTO temporary_private.workspaces(kind,created_at,expires_at,reset_at) VALUES(p_kind,t,CASE WHEN p_kind='guest' THEN t+interval '5 hours' END,CASE WHEN p_kind='demo' THEN ((t AT TIME ZONE 'Asia/Manila')::date+1)::timestamp AT TIME ZONE 'Asia/Manila' END) RETURNING * INTO w;
 INSERT INTO temporary_private.sessions(workspace_id,token_hash,persona,created_at,last_active_at,expires_at) VALUES(w.id,p_token_hash,p_persona,t,t,t+CASE WHEN p_kind='guest' THEN interval '5 hours' ELSE interval '24 hours' END) RETURNING * INTO s;
 IF p_kind='demo' THEN PERFORM temporary_private.seed_demo(w.id); END IF;
 RETURN temporary_private.session_json(s);
END $$;
CREATE FUNCTION public.temporary_session(p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s temporary_private.sessions;
BEGIN s:=temporary_private.lock_session(p_token_hash); RETURN temporary_private.session_json(s); END $$;
CREATE FUNCTION public.temporary_persona(p_token_hash text,p_expected_generation integer,p_persona text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s temporary_private.sessions;
BEGIN
 IF p_expected_generation IS NULL THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 s:=temporary_private.lock_session(p_token_hash,p_expected_generation);
 IF s.persona IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 IF p_persona IS NULL OR p_persona NOT IN ('alice','bob','charlie') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 UPDATE temporary_private.sessions SET persona=p_persona WHERE id=s.id RETURNING * INTO s;
 RETURN temporary_private.session_json(s);
END $$;
CREATE FUNCTION public.temporary_end(p_token_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE w uuid;
BEGIN
 -- Ending an expired session is allowed, but only a matching credential selects it.
 SELECT w0.id INTO w FROM temporary_private.workspaces w0 JOIN temporary_private.sessions s ON s.workspace_id=w0.id WHERE s.token_hash=p_token_hash FOR UPDATE OF w0;
 IF FOUND THEN DELETE FROM temporary_private.workspaces WHERE id=w; END IF;
END $$;

-- Finite dispatch only. No dynamic SQL, persistent tables, or browser owner IDs.
CREATE FUNCTION temporary_private.document_operation(p_token_hash text,p_expected_generation integer,p_action text,p_id uuid DEFAULT NULL,p_input jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE s temporary_private.sessions; d temporary_private.documents; role text; result jsonb; h temporary_private.history; sh temporary_private.shares; a temporary_private.attachments; v_content text; v_title text; total bigint; v_identity text;
BEGIN
 IF p_expected_generation IS NULL OR p_expected_generation<1 OR p_input IS NULL OR jsonb_typeof(p_input)<>'object' OR p_action IS NULL OR p_action NOT IN ('list','get','create','update','remove','restore','list_shares','grant_share','revoke_share','add_attachment','heartbeat') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 s:=temporary_private.lock_session(p_token_hash,p_expected_generation);
 v_identity:=coalesce(s.persona,'guest');
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(temporary_private.document_json(s,docs,false) ORDER BY docs.updated_at DESC,docs.id),'[]'::jsonb) INTO result FROM temporary_private.documents docs WHERE docs.workspace_id=s.workspace_id AND temporary_private.document_role(s,docs) IS NOT NULL;
  RETURN result;
 END IF;
 IF p_action<>'create' THEN
  SELECT * INTO d FROM temporary_private.documents WHERE id=p_id AND workspace_id=s.workspace_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  role:=temporary_private.document_role(s,d);
  IF role IS NULL THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
  IF p_action IN ('update','restore','add_attachment') AND role NOT IN ('owner','editor') THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_action IN ('remove','grant_share','revoke_share') AND role<>'owner' THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  IF p_action IN ('list_shares','grant_share','revoke_share') AND s.persona IS NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 END IF;
 IF p_action IN ('create','update','restore') THEN
  IF p_action='create' AND (SELECT count(*) FROM temporary_private.documents WHERE workspace_id=s.workspace_id)>=20 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
  IF p_action='restore' THEN
   SELECT * INTO h FROM temporary_private.history WHERE id=(p_input->>'versionId')::uuid AND document_id=d.id;
   IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF;
   v_title:=h.title; v_content:=h.content;
  ELSE
   IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('title','content','createVersion')) OR (p_input ? 'title' AND jsonb_typeof(p_input->'title')<>'string') OR (p_input ? 'content' AND jsonb_typeof(p_input->'content')<>'string') OR (p_input ? 'createVersion' AND jsonb_typeof(p_input->'createVersion')<>'boolean') THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   v_title:=CASE WHEN p_action='create' THEN coalesce(p_input->>'title','Untitled') ELSE coalesce(p_input->>'title',d.title) END;
   v_content:=CASE WHEN p_action='create' THEN coalesce(p_input->>'content','') ELSE coalesce(p_input->>'content',d.content) END;
  END IF;
  IF length(btrim(v_title)) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF octet_length(v_content)>1048576 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
  IF p_action='create' THEN
   INSERT INTO temporary_private.documents(workspace_id,owner_persona,title,content) VALUES(s.workspace_id,s.persona,v_title,v_content) RETURNING * INTO d;
  ELSE
   IF p_action='restore' OR coalesce((p_input->>'createVersion')::boolean,false) THEN
    INSERT INTO temporary_private.history(document_id,title,content,updated_by) VALUES(d.id,d.title,d.content,initcap(v_identity));
    DELETE FROM temporary_private.history WHERE document_id=d.id AND id IN (SELECT id FROM temporary_private.history WHERE document_id=d.id ORDER BY updated_at DESC,id DESC OFFSET 50);
   END IF;
   UPDATE temporary_private.documents SET title=v_title,content=v_content,updated_at=clock_timestamp() WHERE id=d.id RETURNING * INTO d;
  END IF;
  SELECT coalesce(sum(octet_length(content)),0) INTO total FROM temporary_private.documents WHERE workspace_id=s.workspace_id;
  SELECT total+coalesce(sum(octet_length(hh.content)),0) INTO total FROM temporary_private.history hh JOIN temporary_private.documents dd ON dd.id=hh.document_id WHERE dd.workspace_id=s.workspace_id;
  IF total>26214400 THEN RAISE EXCEPTION 'QUOTA_EXCEEDED'; END IF;
  RETURN temporary_private.document_json(s,d);
 ELSIF p_action='get' THEN RETURN temporary_private.document_json(s,d);
 ELSIF p_action='remove' THEN DELETE FROM temporary_private.documents WHERE id=d.id; RETURN 'null'::jsonb;
 ELSIF p_action='list_shares' THEN SELECT coalesce(jsonb_agg(temporary_private.share_json(ss) ORDER BY ss.created_at,ss.id),'[]'::jsonb) INTO result FROM temporary_private.shares ss WHERE ss.document_id=d.id; RETURN result;
 ELSIF p_action='grant_share' THEN
  IF p_input->>'permission' IS NULL OR p_input->>'permission' NOT IN ('view','edit') OR p_input->'recipient' IS NULL OR jsonb_typeof(p_input->'recipient')<>'object' OR p_input->'recipient'->>'persona' IS NULL OR p_input->'recipient'->>'persona' NOT IN ('alice','bob','charlie') OR (p_input->'recipient')- 'persona'<>'{}'::jsonb OR p_input->'recipient'->>'persona'=d.owner_persona THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  INSERT INTO temporary_private.shares(document_id,persona,permission) VALUES(d.id,p_input->'recipient'->>'persona',p_input->>'permission') ON CONFLICT(document_id,persona) DO UPDATE SET permission=excluded.permission RETURNING * INTO sh;
  RETURN temporary_private.share_json(sh);
 ELSIF p_action='revoke_share' THEN
  DELETE FROM temporary_private.shares WHERE id=(p_input->>'shareId')::uuid AND document_id=d.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND'; END IF; RETURN 'null'::jsonb;
 ELSIF p_action='add_attachment' THEN
  IF (p_input-ARRAY['filename','mimeType','sizeBytes','url'])<>'{}'::jsonb OR length(p_input->>'filename') NOT BETWEEN 1 AND 255 OR length(p_input->>'mimeType') NOT BETWEEN 1 AND 255 OR jsonb_typeof(p_input->'sizeBytes')<>'number' OR (p_input->>'sizeBytes')::numeric NOT BETWEEN 0 AND 5242880 OR (p_input->>'sizeBytes')::numeric<>trunc((p_input->>'sizeBytes')::numeric) OR p_input->>'url' !~ '^/attachments/[a-f0-9-]+$' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  INSERT INTO temporary_private.attachments(document_id,filename,mime_type,size_bytes,url) VALUES(d.id,p_input->>'filename',p_input->>'mimeType',(p_input->>'sizeBytes')::integer,p_input->>'url') RETURNING * INTO a;
  RETURN temporary_private.attachment_json(a);
 ELSIF p_action='heartbeat' THEN
  IF (p_input-ARRAY['active','cursorOffset','cursorY'])<>'{}'::jsonb OR NOT (p_input ? 'active') OR jsonb_typeof(p_input->'active')<>'boolean' OR (p_input ? 'cursorOffset' AND (jsonb_typeof(p_input->'cursorOffset')<>'number' OR (p_input->>'cursorOffset')::numeric NOT BETWEEN 0 AND 10000000 OR (p_input->>'cursorOffset')::numeric<>trunc((p_input->>'cursorOffset')::numeric))) OR (p_input ? 'cursorY' AND (jsonb_typeof(p_input->'cursorY')<>'number' OR (p_input->>'cursorY')::numeric NOT BETWEEN -1000000 AND 1000000)) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF (p_input->>'active')::boolean THEN
   INSERT INTO temporary_private.presence(document_id,identity,cursor_offset,cursor_y) VALUES(d.id,v_identity,(p_input->>'cursorOffset')::integer,(p_input->>'cursorY')::double precision) ON CONFLICT(document_id,identity) DO UPDATE SET cursor_offset=excluded.cursor_offset,cursor_y=excluded.cursor_y,last_active_at=clock_timestamp();
  ELSE DELETE FROM temporary_private.presence p WHERE p.document_id=d.id AND p.identity=v_identity; END IF;
  SELECT coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('userId',p.identity,'name',initcap(p.identity),'avatar',upper(left(p.identity,1)),'color',CASE p.identity WHEN 'alice' THEN '#7c3aed' WHEN 'bob' THEN '#2563eb' WHEN 'charlie' THEN '#059669' ELSE '#64748b' END,'cursorOffset',p.cursor_offset,'cursorY',p.cursor_y,'lastActive',floor(extract(epoch FROM p.last_active_at)*1000))) ORDER BY p.identity),'[]'::jsonb) INTO result FROM temporary_private.presence p WHERE p.document_id=d.id AND p.last_active_at>clock_timestamp()-interval '30 seconds';
  RETURN result;
 END IF;
 RAISE EXCEPTION 'VALIDATION_ERROR';
END $$;

CREATE FUNCTION public.temporary_list(p_token_hash text,p_expected_generation integer) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'list',NULL,'{}'::jsonb);
$$;

CREATE FUNCTION public.temporary_get(p_token_hash text,p_expected_generation integer,p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'get',p_id,'{}'::jsonb);
$$;

CREATE FUNCTION public.temporary_create(p_token_hash text,p_expected_generation integer,p_input jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'create',NULL,p_input);
$$;

CREATE FUNCTION public.temporary_update(p_token_hash text,p_expected_generation integer,p_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'update',p_id,p_input);
$$;

CREATE FUNCTION public.temporary_remove(p_token_hash text,p_expected_generation integer,p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'remove',p_id,'{}'::jsonb);
$$;

CREATE FUNCTION public.temporary_restore(p_token_hash text,p_expected_generation integer,p_id uuid,p_version_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'restore',p_id,jsonb_build_object('versionId',p_version_id));
$$;

CREATE FUNCTION public.temporary_list_shares(p_token_hash text,p_expected_generation integer,p_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'list_shares',p_id,'{}'::jsonb);
$$;

CREATE FUNCTION public.temporary_grant_share(p_token_hash text,p_expected_generation integer,p_id uuid,p_recipient jsonb,p_permission text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'grant_share',p_id,jsonb_build_object('recipient',p_recipient,'permission',p_permission));
$$;

CREATE FUNCTION public.temporary_revoke_share(p_token_hash text,p_expected_generation integer,p_id uuid,p_share_id uuid) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'revoke_share',p_id,jsonb_build_object('shareId',p_share_id));
$$;

CREATE FUNCTION public.temporary_add_attachment(p_token_hash text,p_expected_generation integer,p_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'add_attachment',p_id,p_input);
$$;

CREATE FUNCTION public.temporary_heartbeat(p_token_hash text,p_expected_generation integer,p_id uuid,p_input jsonb) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT temporary_private.document_operation(p_token_hash,p_expected_generation,'heartbeat',p_id,p_input);
$$;

REVOKE ALL ON ALL TABLES IN SCHEMA temporary_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA temporary_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.temporary_start(text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_start(text,text,text) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_session(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_session(text) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_persona(text,integer,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_persona(text,integer,text) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_end(text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_end(text) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_list(text,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_list(text,integer) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_get(text,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_get(text,integer,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_create(text,integer,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_create(text,integer,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_update(text,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_update(text,integer,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_remove(text,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_remove(text,integer,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_restore(text,integer,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_restore(text,integer,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_list_shares(text,integer,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_list_shares(text,integer,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_grant_share(text,integer,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_grant_share(text,integer,uuid,jsonb,text) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_revoke_share(text,integer,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_revoke_share(text,integer,uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_add_attachment(text,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_add_attachment(text,integer,uuid,jsonb) TO service_role;
REVOKE ALL ON FUNCTION public.temporary_heartbeat(text,integer,uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.temporary_heartbeat(text,integer,uuid,jsonb) TO service_role;
ALTER TABLE temporary_private.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporary_private.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporary_private.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporary_private.history ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporary_private.shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporary_private.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE temporary_private.presence ENABLE ROW LEVEL SECURITY;
