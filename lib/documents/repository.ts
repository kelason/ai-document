import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Attachment, DocumentDetail, DocumentPermissions, DocumentStore, DocumentSummary, Operation, Share } from './types';
import { canPerform } from './permissions';
import { ApiError } from '../http/errors';
import { createDocumentSchema, idSchema, presenceSchema, updateDocumentSchema } from '../security/validation';
import { sanitizeDocumentHtml } from '../security/html';

const operations: Operation[] = ['read','edit','upload','restore','delete','manage-shares','presence'];
const profileColumns = 'id,display_name,avatar_url';
const summaryColumns = `id,owner_id,title,created_at,updated_at,owner:profiles!documents_owner_id_fkey(${profileColumns}),document_shares(id,document_id,user_id,permission,created_at)`;
const detailColumns = `${summaryColumns},content,document_history(id,title,content,updated_at,updated_by,author:profiles!document_history_updated_by_fkey(${profileColumns})),document_attachments(id,document_id,filename,mime_type,size_bytes,url,uploaded_at)`;
interface ProfileRow { id:string; display_name:string; avatar_url:string|null }
interface ShareRow { id:string; document_id:string; user_id:string; permission:'view'|'edit'; created_at:string }
interface AttachmentRow { id:string; document_id:string; filename:string; mime_type:string; size_bytes:number; url:string; uploaded_at:string }
interface DocumentRow { id:string; owner_id:string; title:string; created_at:string; updated_at:string; owner:ProfileRow|null; document_shares:ShareRow[]; content?:string; document_history?:{id:string;title:string;content:string;updated_at:string;updated_by:string|null;author:ProfileRow|null}[]; document_attachments?:AttachmentRow[] }
interface PresenceRow { user_id:string; cursor_x:number|null; cursor_y:number|null; updated_at:string; profile:ProfileRow|null }
const missing = () => new ApiError('NOT_FOUND','Document not found.');
function databaseError(error:{code?:string}|null):void {
  if (!error) return;
  if (['42501','PGRST116'].includes(error.code??'')) throw missing();
  if (['23514','22023','22P02'].includes(error.code??'')) throw new ApiError('VALIDATION_ERROR','Invalid document input.');
  throw new ApiError('STORAGE_UNAVAILABLE','Storage is temporarily unavailable.');
}
function parse<T extends z.ZodType>(schema:T,value:unknown):z.output<T> { const result=schema.safeParse(value); if(!result.success) throw new ApiError('VALIDATION_ERROR','Invalid request.'); return result.data; }
const attachmentSchema=z.object({filename:z.string().min(1).max(255).regex(/^[^\\/\u0000-\u001f\u007f]+$/),mimeType:z.string().min(1).max(255),sizeBytes:z.number().int().min(0).max(5242880),url:z.string().regex(/^\/attachments\/[a-f0-9-]+$/).max(2048)}).strict();
function share(row:ShareRow):Share { return {id:row.id,documentId:row.document_id,recipient:{userId:row.user_id},permission:row.permission,createdAt:row.created_at}; }
function attachment(row:AttachmentRow):Attachment { return {id:row.id,documentId:row.document_id,filename:row.filename,mimeType:row.mime_type,sizeBytes:Number(row.size_bytes),url:/^\/attachments\/[a-f0-9-]+$/.test(row.url)?row.url:'',uploadedAt:row.uploaded_at}; }
function permissions(row:DocumentRow,userId:string):DocumentPermissions {
  const ownShare=row.document_shares.find(s=>s.user_id===userId);
  const role=row.owner_id===userId?'owner':ownShare?.permission==='edit'?'editor':ownShare?.permission==='view'?'viewer':null;
  if (!role) throw missing();
  return {role,allowedOperations:operations.filter(operation=>canPerform(role,operation))};
}
function summary(row:DocumentRow,userId:string):DocumentSummary { return {id:row.id,title:row.title,createdAt:row.created_at,updatedAt:row.updated_at,owner:row.owner?.display_name??'Account',ownerId:row.owner_id,permissions:permissions(row,userId)}; }
function detail(row:DocumentRow,userId:string):DocumentDetail {
  return {...summary(row,userId),content:sanitizeDocumentHtml(row.content??''),history:(row.document_history??[]).sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||b.id.localeCompare(a.id)).map(v=>({id:v.id,title:v.title,content:sanitizeDocumentHtml(v.content),updatedAt:v.updated_at,updatedBy:v.author?.display_name??'Account'})),shares:row.document_shares.map(share),attachments:(row.document_attachments??[]).map(attachment)};
}
/** Pass only the requesting user's SSR client. RLS is the backstop on every query. */
export function createPersistentStore(client:SupabaseClient):DocumentStore {
  let identity:Promise<string>|undefined;
  const userId=()=>identity??=(async()=>{const {data:{user},error}=await client.auth.getUser(); if(error||!user) throw new ApiError('UNAUTHENTICATED','Sign in to continue.'); return user.id;})();
  const id=(value:string)=>parse(idSchema,value);
  const get=async(value:string)=>{ const uid=await userId(); const result=await client.from('documents').select(detailColumns).eq('id',id(value)).maybeSingle(); databaseError(result.error); if(!result.data) throw missing(); return detail(result.data as unknown as DocumentRow,uid); };
  const authorize=async(value:string,operation:Operation)=>{const doc=await get(value); if(!doc.permissions.allowedOperations.includes(operation)) throw new ApiError('FORBIDDEN','This operation is not allowed.'); return doc;};
  const mutate=async(name:string,args:Record<string,unknown>)=>{const result=await client.rpc(name,args).single<{id:string}>(); databaseError(result.error); if(!result.data?.id) throw missing(); return get(result.data.id);};
  return {
    async list(){ const uid=await userId(); const result=await client.from('documents').select(summaryColumns).order('updated_at',{ascending:false}); databaseError(result.error); return (result.data as unknown as DocumentRow[]??[]).map(row=>summary(row,uid)); },
    get,
    async create(input){const {title,content}=parse(createDocumentSchema,input); return mutate('create_document',{p_title:title,p_content:content});},
    async update(value,input){const parsed=parse(updateDocumentSchema,input); await authorize(value,'edit'); return mutate('update_document',{p_document_id:id(value),p_title:parsed.title??null,p_content:parsed.content??null,p_create_version:parsed.createVersion??true});},
    async remove(value){await authorize(value,'delete'); const result=await client.from('documents').delete().eq('id',id(value)).select('id'); databaseError(result.error); if(!result.data?.length) throw missing();},
    async restore(value,versionId){await authorize(value,'restore'); // restore_document revalidates that the version belongs to this document inside the atomic transaction; detail() sanitizes the returned snapshot.
      return mutate('restore_document',{p_document_id:id(value),p_version_id:id(versionId)});},
    async listShares(value){return (await get(value)).shares;},
    async grantShare(value,recipient,permission){await authorize(value,'manage-shares'); const parsed=parse(z.object({userId:idSchema}).strict(),recipient); const result=await client.rpc('grant_document_share',{p_document_id:id(value),p_user_id:parsed.userId,p_permission:parse(z.enum(['view','edit']),permission)}).single<ShareRow>(); databaseError(result.error); if(!result.data) throw missing(); return share(result.data);},
    async revokeShare(value,shareId){await authorize(value,'manage-shares'); const result=await client.from('document_shares').delete().eq('document_id',id(value)).eq('id',id(shareId)).select('id'); databaseError(result.error); if(!result.data?.length) throw missing();},
    async addAttachment(value,input){await authorize(value,'upload'); const parsed=parse(attachmentSchema,input); const result=await client.from('document_attachments').insert({document_id:id(value),uploaded_by:await userId(),filename:parsed.filename,mime_type:parsed.mimeType,size_bytes:parsed.sizeBytes,url:parsed.url}).select('id,document_id,filename,mime_type,size_bytes,url,uploaded_at').single<AttachmentRow>(); databaseError(result.error); if(!result.data) throw missing(); return attachment(result.data);},
    async heartbeat(value,input){await authorize(value,'presence'); const parsed=parse(presenceSchema,input); const uid=await userId(); const docId=id(value);
      // Column grants deliberately prohibit upserting document_id/user_id on UPDATE.
      const mutable={active:parsed.active,cursor_x:parsed.cursorOffset??null,cursor_y:parsed.cursorY===undefined?null:Math.round(parsed.cursorY)};
      const update=()=>client.from('document_presence').update(mutable).eq('document_id',docId).eq('user_id',uid).select('user_id');
      let result=await update(); databaseError(result.error);
      if(!result.data?.length){const inserted=await client.from('document_presence').insert({document_id:docId,user_id:uid,...mutable}); if(inserted.error?.code==='23505'){result=await update(); databaseError(result.error); if(!result.data?.length) throw missing();} else databaseError(inserted.error);}
      const active=await client.from('document_presence').select(`user_id,cursor_x,cursor_y,updated_at,profile:profiles!document_presence_user_id_fkey(${profileColumns})`).eq('document_id',docId).eq('active',true).neq('user_id',uid).gte('updated_at',new Date(Date.now()-10000).toISOString()); databaseError(active.error);
      // Recheck after writes/reads so a concurrent revocation cannot return stale presence.
      await authorize(value,'presence');
      return (active.data as unknown as PresenceRow[]??[]).map(row=>({userId:row.user_id,name:row.profile?.display_name??'Account',avatar:(row.profile?.display_name??'?').slice(0,1),color:'#6366f1',cursorOffset:row.cursor_x??undefined,cursorY:row.cursor_y??undefined,lastActive:Date.parse(row.updated_at)}));
    },
  };
}
