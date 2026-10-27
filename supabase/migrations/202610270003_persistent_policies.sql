-- Persistent clients use their own JWT. Definer functions expose only specific
-- document operations, and derive identity from auth.uid(), never parameters.
CREATE SCHEMA IF NOT EXISTS persistent_security AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA persistent_security FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA persistent_security TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA persistent_security REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE FUNCTION persistent_security.sync_auth_profile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.email IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.profiles(id,email,display_name,verified)
  VALUES(NEW.id,lower(NEW.email),left(coalesce(nullif(btrim(NEW.raw_user_meta_data->>'display_name'),''),split_part(NEW.email,'@',1)),100),
    NEW.email_confirmed_at IS NOT NULL AND NEW.deleted_at IS NULL)
  ON CONFLICT(id) DO UPDATE SET email=excluded.email, verified=excluded.verified, updated_at=now();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION persistent_security.sync_auth_profile() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER sync_auth_profile_insert AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION persistent_security.sync_auth_profile();
CREATE TRIGGER sync_auth_profile_update AFTER UPDATE OF email,email_confirmed_at,banned_until,deleted_at ON auth.users
FOR EACH ROW EXECUTE FUNCTION persistent_security.sync_auth_profile();
-- Existing trusted Auth identities are backfilled; no archived demo identities
-- or raw metadata can promote an account to verified.
INSERT INTO public.profiles(id,email,display_name,verified)
SELECT u.id,lower(u.email),left(coalesce(nullif(btrim(u.raw_user_meta_data->>'display_name'),''),split_part(u.email,'@',1)),100),
 u.email_confirmed_at IS NOT NULL AND u.deleted_at IS NULL
FROM auth.users u WHERE u.email IS NOT NULL
ON CONFLICT(id) DO UPDATE SET email=excluded.email,verified=excluded.verified,updated_at=now();

CREATE FUNCTION persistent_security.verified_account(p_user_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT EXISTS (SELECT 1 FROM auth.users u JOIN public.profiles p ON p.id=u.id
 WHERE u.id=p_user_id AND p.verified AND u.email_confirmed_at IS NOT NULL
 AND u.deleted_at IS NULL AND (u.banned_until IS NULL OR u.banned_until<=now()));
$$;
REVOKE ALL ON FUNCTION persistent_security.verified_account(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.is_verified_user() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT persistent_security.verified_account(auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_verified_user() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.is_verified_user() TO authenticated;

-- This helper bypasses RLS only to answer the current user's permission for one
-- document. It avoids documents -> shares -> documents policy recursion.
CREATE FUNCTION persistent_security.can_access(p_document_id uuid,p_operation text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT persistent_security.verified_account(auth.uid()) AND EXISTS (
  SELECT 1 FROM public.documents d WHERE d.id=p_document_id AND (
   d.owner_id=auth.uid() OR (p_operation IN ('read','edit') AND EXISTS (
    SELECT 1 FROM public.document_shares s WHERE s.document_id=d.id AND s.user_id=auth.uid()
    AND (p_operation='read' OR s.permission='edit')))));
$$;
REVOKE ALL ON FUNCTION persistent_security.can_access(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION persistent_security.can_access(uuid,text) TO authenticated;

CREATE FUNCTION persistent_security.can_view_profile(p_profile_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
 SELECT p_profile_id=auth.uid() OR EXISTS (
  SELECT 1 FROM public.documents d WHERE persistent_security.can_access(d.id,'read') AND (
   d.owner_id=p_profile_id OR EXISTS (SELECT 1 FROM public.document_shares s WHERE s.document_id=d.id AND s.user_id=p_profile_id)
   OR EXISTS (SELECT 1 FROM public.document_history h WHERE h.document_id=d.id AND h.updated_by=p_profile_id)
   OR EXISTS (SELECT 1 FROM public.document_attachments a WHERE a.document_id=d.id AND a.uploaded_by=p_profile_id)
   OR EXISTS (SELECT 1 FROM public.document_presence p WHERE p.document_id=d.id AND p.user_id=p_profile_id)));
$$;
REVOKE ALL ON FUNCTION persistent_security.can_view_profile(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION persistent_security.can_view_profile(uuid) TO authenticated;

GRANT SELECT(id,display_name,avatar_url,verified,created_at,updated_at) ON public.profiles TO authenticated;
GRANT UPDATE(display_name,avatar_url) ON public.profiles TO authenticated;
CREATE POLICY profiles_read ON public.profiles FOR SELECT TO authenticated USING (persistent_security.can_view_profile(id));
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE TO authenticated USING (id=auth.uid()) WITH CHECK (id=auth.uid());

-- No direct INSERT/UPDATE on documents/history: atomic RPCs produce the current
-- document and its history together; callers cannot forge history attribution.
GRANT SELECT,DELETE ON public.documents TO authenticated;
GRANT SELECT ON public.document_history TO authenticated;
CREATE POLICY documents_read ON public.documents FOR SELECT TO authenticated USING (persistent_security.can_access(id,'read'));
CREATE POLICY documents_delete ON public.documents FOR DELETE TO authenticated USING (persistent_security.can_access(id,'owner'));
CREATE POLICY history_read ON public.document_history FOR SELECT TO authenticated USING (persistent_security.can_access(document_id,'read'));

GRANT SELECT,DELETE ON public.document_shares TO authenticated;
CREATE POLICY shares_read ON public.document_shares FOR SELECT TO authenticated USING (persistent_security.can_access(document_id,'read'));
CREATE POLICY shares_delete ON public.document_shares FOR DELETE TO authenticated USING (persistent_security.can_access(document_id,'owner'));

GRANT SELECT ON public.document_attachments TO authenticated;
GRANT INSERT(document_id,uploaded_by,filename,mime_type,size_bytes,url) ON public.document_attachments TO authenticated;
CREATE POLICY attachments_read ON public.document_attachments FOR SELECT TO authenticated USING (persistent_security.can_access(document_id,'read'));
CREATE POLICY attachments_insert ON public.document_attachments FOR INSERT TO authenticated
 WITH CHECK (uploaded_by=auth.uid() AND persistent_security.can_access(document_id,'edit'));

GRANT SELECT,DELETE ON public.document_presence TO authenticated;
GRANT INSERT(document_id,user_id,active,cursor_x,cursor_y) ON public.document_presence TO authenticated;
GRANT UPDATE(active,cursor_x,cursor_y) ON public.document_presence TO authenticated;
CREATE POLICY presence_read ON public.document_presence FOR SELECT TO authenticated USING (persistent_security.can_access(document_id,'read'));
CREATE POLICY presence_insert ON public.document_presence FOR INSERT TO authenticated
 WITH CHECK (user_id=auth.uid() AND persistent_security.can_access(document_id,'read'));
CREATE POLICY presence_update ON public.document_presence FOR UPDATE TO authenticated
 USING (user_id=auth.uid() AND persistent_security.can_access(document_id,'read'))
 WITH CHECK (user_id=auth.uid() AND persistent_security.can_access(document_id,'read'));
CREATE POLICY presence_delete ON public.document_presence FOR DELETE TO authenticated
 USING (user_id=auth.uid() AND persistent_security.can_access(document_id,'read'));
CREATE FUNCTION persistent_security.touch_presence() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN NEW.updated_at=now(); RETURN NEW; END;
$$;
REVOKE ALL ON FUNCTION persistent_security.touch_presence() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER touch_presence BEFORE UPDATE ON public.document_presence FOR EACH ROW EXECUTE FUNCTION persistent_security.touch_presence();

CREATE FUNCTION public.create_document(p_title text,p_content text) RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.documents;
BEGIN
 IF NOT persistent_security.verified_account(auth.uid()) THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.documents(owner_id,title,content) VALUES(auth.uid(),p_title,p_content) RETURNING * INTO result;
 INSERT INTO public.document_history(document_id,title,content,updated_by) VALUES(result.id,result.title,result.content,auth.uid());
 RETURN result;
END;
$$;

CREATE FUNCTION public.update_document(p_document_id uuid,p_title text DEFAULT NULL,p_content text DEFAULT NULL,p_create_version boolean DEFAULT true) RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.documents;
BEGIN
 -- Lock the document so competing mutations are ordered and history snapshots
 -- always correspond to the saved row, including restore and share grants.
 IF NOT persistent_security.can_access(p_document_id,'edit') THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.documents WHERE id=p_document_id FOR UPDATE;
 IF NOT persistent_security.can_access(p_document_id,'edit') THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 UPDATE public.documents SET title=coalesce(p_title,title),content=coalesce(p_content,content),updated_at=now()
 WHERE id=p_document_id RETURNING * INTO result;
 IF coalesce(p_create_version,true) THEN
  INSERT INTO public.document_history(document_id,title,content,updated_by) VALUES(result.id,result.title,result.content,auth.uid());
 END IF;
 RETURN result;
END;
$$;

CREATE FUNCTION public.restore_document(p_document_id uuid,p_version_id uuid) RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE version public.document_history; result public.documents;
BEGIN
 IF NOT persistent_security.can_access(p_document_id,'edit') THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.documents WHERE id=p_document_id FOR UPDATE;
 IF NOT persistent_security.can_access(p_document_id,'edit') THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 SELECT * INTO version FROM public.document_history WHERE id=p_version_id AND document_id=p_document_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 UPDATE public.documents SET title=version.title,content=version.content,updated_at=now() WHERE id=p_document_id RETURNING * INTO result;
 INSERT INTO public.document_history(document_id,title,content,updated_by) VALUES(result.id,result.title,result.content,auth.uid());
 RETURN result;
END;
$$;

CREATE FUNCTION public.resolve_share_recipient(p_document_id uuid,p_email text) RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE recipient uuid;
BEGIN
 IF NOT persistent_security.can_access(p_document_id,'owner') THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 IF p_email IS NULL OR char_length(p_email)>320 THEN RETURN NULL; END IF;
 SELECT p.id INTO recipient FROM public.profiles p WHERE lower(p.email)=lower(btrim(p_email))
 AND p.id<>auth.uid() AND persistent_security.verified_account(p.id);
 RETURN recipient;
END;
$$;

CREATE FUNCTION public.grant_document_share(p_document_id uuid,p_user_id uuid,p_permission text) RETURNS public.document_shares
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.document_shares;
BEGIN
 IF NOT persistent_security.can_access(p_document_id,'owner') THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.documents WHERE id=p_document_id FOR UPDATE;
 IF NOT persistent_security.can_access(p_document_id,'owner') THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 IF p_user_id IS NULL OR p_user_id=auth.uid() OR NOT persistent_security.verified_account(p_user_id) THEN
  RAISE EXCEPTION 'Recipient is unavailable.' USING ERRCODE='42501';
 END IF;
 IF p_permission IS NULL OR p_permission NOT IN ('view','edit') THEN RAISE EXCEPTION 'Invalid permission.' USING ERRCODE='22023'; END IF;
 INSERT INTO public.document_shares(document_id,user_id,permission) VALUES(p_document_id,p_user_id,p_permission)
 ON CONFLICT(document_id,user_id) DO UPDATE SET permission=excluded.permission RETURNING * INTO result;
 RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_document(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.update_document(uuid,text,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.restore_document(uuid,uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.resolve_share_recipient(uuid,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.grant_document_share(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_document(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_document(uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_document(uuid,uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_share_recipient(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_document_share(uuid,uuid,text) TO authenticated;
