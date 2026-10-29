-- Cap persistent history at 50 revisions per document inside the same
-- transaction that writes the revision. The temporary-workspace path already
-- prunes in temporary_private.document_operation (migration 0005); before
-- this migration the persistent RPCs inserted history without any bound, so
-- the 50-revision limit existed only as an unused TypeScript constant.

CREATE OR REPLACE FUNCTION public.create_document(p_title text,p_content text) RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.documents;
BEGIN
 IF NOT persistent_security.verified_account(auth.uid()) THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 INSERT INTO public.documents(owner_id,title,content) VALUES(auth.uid(),p_title,p_content) RETURNING * INTO result;
 INSERT INTO public.document_history(document_id,title,content,updated_by) VALUES(result.id,result.title,result.content,auth.uid());
 DELETE FROM public.document_history WHERE document_id=result.id AND id IN (SELECT id FROM public.document_history WHERE document_id=result.id ORDER BY updated_at DESC,id DESC OFFSET 50);
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_document(p_document_id uuid,p_title text DEFAULT NULL,p_content text DEFAULT NULL,p_create_version boolean DEFAULT true) RETURNS public.documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE result public.documents;
BEGIN
 IF NOT persistent_security.can_access(p_document_id,'edit') THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.documents WHERE id=p_document_id FOR UPDATE;
 IF NOT persistent_security.can_access(p_document_id,'edit') THEN RAISE EXCEPTION 'Document is unavailable.' USING ERRCODE='42501'; END IF;
 UPDATE public.documents SET title=coalesce(p_title,title),content=coalesce(p_content,content),updated_at=now()
 WHERE id=p_document_id RETURNING * INTO result;
 IF coalesce(p_create_version,true) THEN
  INSERT INTO public.document_history(document_id,title,content,updated_by) VALUES(result.id,result.title,result.content,auth.uid());
  DELETE FROM public.document_history WHERE document_id=result.id AND id IN (SELECT id FROM public.document_history WHERE document_id=result.id ORDER BY updated_at DESC,id DESC OFFSET 50);
 END IF;
 RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_document(p_document_id uuid,p_version_id uuid) RETURNS public.documents
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
 DELETE FROM public.document_history WHERE document_id=result.id AND id IN (SELECT id FROM public.document_history WHERE document_id=result.id ORDER BY updated_at DESC,id DESC OFFSET 50);
 RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.create_document(text,text) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.update_document(uuid,text,text,boolean) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.restore_document(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_document(text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_document(uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_document(uuid,uuid) TO authenticated;
