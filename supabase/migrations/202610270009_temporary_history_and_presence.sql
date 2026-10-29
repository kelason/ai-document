-- Align normal temporary autosave/version semantics with persistent documents.
-- Keep previous migrations immutable; use the current lock_session/deadline guard.
ALTER TABLE public.document_presence DROP CONSTRAINT document_presence_cursor_x_check;
ALTER TABLE public.document_presence ADD CHECK(cursor_x BETWEEN 0 AND 10000000);
ALTER TABLE public.document_presence DROP CONSTRAINT document_presence_cursor_y_check;
ALTER TABLE public.document_presence ADD CHECK(cursor_y BETWEEN -1000000 AND 1000000);

CREATE OR REPLACE FUNCTION temporary_private.document_operation(p_token_hash text,p_expected_generation integer,p_action text,p_id uuid DEFAULT NULL,p_input jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
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
   UPDATE temporary_private.documents SET title=v_title,content=v_content,updated_at=clock_timestamp() WHERE id=d.id RETURNING * INTO d;
  END IF;
  -- Match persistent history: record the resulting current state, including
  -- initial creation. Normal autosaves create versions unless explicitly false.
  IF p_action IN ('create','restore') OR coalesce((p_input->>'createVersion')::boolean,true) THEN
   INSERT INTO temporary_private.history(document_id,title,content,updated_by) VALUES(d.id,d.title,d.content,initcap(v_identity));
   DELETE FROM temporary_private.history WHERE document_id=d.id AND id IN (SELECT id FROM temporary_private.history WHERE document_id=d.id ORDER BY updated_at DESC,id DESC OFFSET 50);
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

REVOKE ALL ON FUNCTION temporary_private.document_operation(text,integer,text,uuid,jsonb) FROM PUBLIC,anon,authenticated,service_role;
