-- Service-only two-phase transfer. The snapshot is immutable by comparison,
-- never a client capability. Both phases require a verified account and cookie.
CREATE TABLE temporary_private.claim_receipts (
 token_hash text PRIMARY KEY CHECK(token_hash ~ '^[a-f0-9]{64}$'),
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
 document_ids jsonb NOT NULL CHECK(jsonb_typeof(document_ids)='array'),
 source_expires_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours'
);
CREATE INDEX claim_receipts_expiry_idx ON temporary_private.claim_receipts(expires_at);
ALTER TABLE temporary_private.claim_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON temporary_private.claim_receipts FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION temporary_private.claim_snapshot(p_workspace uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path='' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'content',d.content,'history',
   coalesce((SELECT jsonb_agg(jsonb_build_object('id',h.id,'content',h.content) ORDER BY h.id) FROM temporary_private.history h WHERE h.document_id=d.id),'[]'::jsonb)) ORDER BY d.id),'[]'::jsonb)
 FROM temporary_private.documents d WHERE d.workspace_id=p_workspace;
$$;
-- Lock credentials even when the source has already been consumed. This avoids
-- racing two initial claims into duplicate copies or a false expiry response.
CREATE FUNCTION temporary_private.claim_context(p_user_id uuid,p_token_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r temporary_private.claim_receipts; s temporary_private.sessions; w temporary_private.workspaces; snapshot jsonb;
BEGIN
 IF p_token_hash IS NULL OR p_token_hash !~ '^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 -- Keep verification stable until the transaction finishes.
 PERFORM 1 FROM auth.users WHERE id=p_user_id FOR SHARE;
 PERFORM 1 FROM public.profiles WHERE id=p_user_id FOR SHARE;
 IF NOT persistent_security.verified_account(p_user_id) THEN RAISE EXCEPTION 'VERIFICATION_REQUIRED'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_token_hash,1729));
 SELECT * INTO r FROM temporary_private.claim_receipts WHERE token_hash=p_token_hash;
 IF FOUND AND r.expires_at>clock_timestamp() THEN
  IF r.user_id<>p_user_id THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
  RETURN jsonb_build_object('receipt',jsonb_build_object('documentIds',r.document_ids));
 END IF;
 s:=temporary_private.lock_session(p_token_hash);
 SELECT * INTO w FROM temporary_private.workspaces WHERE id=s.workspace_id;
 IF w.kind<>'guest' OR s.persona IS NOT NULL THEN RAISE EXCEPTION 'FORBIDDEN'; END IF;
 snapshot:=temporary_private.claim_snapshot(w.id);
 -- Include all source columns in the comparison, including titles/timestamps
 -- and metadata which are copied only from locked database rows.
 RETURN jsonb_build_object('workspaceId',w.id,'expiresAt',least(w.expires_at,s.expires_at),
  'snapshotHash',md5(snapshot::text||coalesce((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.id)::text FROM temporary_private.documents d WHERE d.workspace_id=w.id),'[]')||coalesce((SELECT jsonb_agg(to_jsonb(h) ORDER BY h.id)::text FROM temporary_private.history h JOIN temporary_private.documents d ON d.id=h.document_id WHERE d.workspace_id=w.id),'[]')),
  'documents',snapshot);
END $$;

CREATE FUNCTION public.prepare_guest_claim(p_user_id uuid,p_token_hash text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT temporary_private.claim_context(p_user_id,p_token_hash); $$;

CREATE FUNCTION public.claim_guest_workspace(p_user_id uuid,p_token_hash text,p_snapshot_hash text,p_documents jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE ctx jsonb; snapshot jsonb; w uuid; d temporary_private.documents; h temporary_private.history;
 input jsonb; history_input jsonb; new_id uuid; ids jsonb:='[]';
BEGIN
 ctx:=temporary_private.claim_context(p_user_id,p_token_hash);
 IF ctx ? 'receipt' THEN RETURN ctx->'receipt'; END IF;
 IF p_snapshot_hash IS DISTINCT FROM ctx->>'snapshotHash' OR jsonb_typeof(p_documents) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 snapshot:=ctx->'documents'; w:=(ctx->>'workspaceId')::uuid;
 IF jsonb_array_length(p_documents)<>jsonb_array_length(snapshot) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
 -- Exact ids/order and history structure; only HTML is supplied by the trusted
 -- server sanitizer. No owner, title, timestamp, attachment or share input.
 FOR d IN SELECT * FROM temporary_private.documents WHERE workspace_id=w ORDER BY id LOOP
  input:=p_documents->jsonb_array_length(ids);
  IF (input-'content'-'history') IS DISTINCT FROM ((snapshot->jsonb_array_length(ids))-'content'-'history') OR jsonb_typeof(input->'content') IS DISTINCT FROM 'string' OR jsonb_typeof(input->'history') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  IF jsonb_array_length(input->'history')<>(SELECT count(*) FROM temporary_private.history WHERE document_id=d.id) THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
  INSERT INTO public.documents(owner_id,title,content,created_at,updated_at) VALUES(p_user_id,d.title,input->>'content',d.created_at,d.updated_at) RETURNING id INTO new_id;
  FOR h IN SELECT * FROM temporary_private.history WHERE document_id=d.id ORDER BY id LOOP
   SELECT v INTO history_input FROM jsonb_array_elements(input->'history') v WHERE v->>'id'=h.id::text;
   IF history_input IS NULL OR (history_input-'content')<>jsonb_build_object('id',h.id) OR jsonb_typeof(history_input->'content') IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'VALIDATION_ERROR'; END IF;
   INSERT INTO public.document_history(document_id,title,content,updated_at,updated_by) VALUES(new_id,h.title,history_input->>'content',h.updated_at,p_user_id);
  END LOOP;
  ids:=ids||jsonb_build_array(new_id);
 END LOOP;
 IF (ctx->>'expiresAt')::timestamptz<=clock_timestamp() THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 INSERT INTO temporary_private.claim_receipts(token_hash,user_id,document_ids,source_expires_at) VALUES(p_token_hash,p_user_id,ids,(ctx->>'expiresAt')::timestamptz);
 DELETE FROM temporary_private.workspaces WHERE id=w;
 RETURN jsonb_build_object('documentIds',ids);
END $$;

-- A claim that waits or does work past the deadline must roll back even after
-- deletion of the source workspace. Replayed receipts do not insert a new row.
CREATE FUNCTION temporary_private.check_claim_deadline() RETURNS trigger
LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
 IF NEW.source_expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'SESSION_EXPIRED'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER claim_commit_deadline AFTER INSERT ON temporary_private.claim_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION temporary_private.check_claim_deadline();
CREATE FUNCTION public.purge_guest_claim_receipts() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ DELETE FROM temporary_private.claim_receipts WHERE expires_at<=statement_timestamp(); $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA temporary_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.prepare_guest_claim(uuid,text), public.claim_guest_workspace(uuid,text,text,jsonb), public.purge_guest_claim_receipts() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_guest_claim(uuid,text), public.claim_guest_workspace(uuid,text,text,jsonb), public.purge_guest_claim_receipts() TO service_role;
SELECT cron.schedule('ai-docs-claim-receipt-retention','* * * * *','SELECT public.purge_guest_claim_receipts();');
