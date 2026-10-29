import 'server-only';
import { z } from 'zod';
import type { Attachment, DocumentDetail, DocumentStore, DocumentSummary, Presence, Share } from '../documents/types';
import { ApiError } from '../http/errors';
import { createDocumentSchema, idSchema, personaSchema, presenceSchema, updateDocumentSchema } from '../security/validation';
import { temporaryRpc, type TemporaryCredential } from './sessions';

const attachmentSchema=z.object({filename:z.string().min(1).max(255),mimeType:z.string().min(1).max(255),sizeBytes:z.number().int().min(0).max(5242880),url:z.string().max(2048).regex(/^\/attachments\/[a-f0-9-]+$/)}).strict();
function parse<T extends z.ZodType>(schema:T,input:unknown):z.output<T> {
  const parsed=schema.safeParse(input);
  if (!parsed.success) throw new ApiError('VALIDATION_ERROR','Invalid request.');
  return parsed.data;
}
/** Actor metadata is never authority: SQL rechecks credential, generation and rights on EVERY call. */
export function createTemporaryStore(credential:TemporaryCredential,expectedGeneration:number):DocumentStore {
  if (!credential || !/^[a-f0-9]{64}$/.test(credential.tokenHash) || !Number.isSafeInteger(expectedGeneration) || expectedGeneration<1) throw new ApiError('VALIDATION_ERROR','A valid workspace generation is required.');
  const invoke=<T>(name:string,args:Record<string,unknown>={})=>temporaryRpc<T>(`temporary_${name}`,{p_token_hash:credential.tokenHash,p_expected_generation:expectedGeneration,...args});
  const id=(value:string)=>parse(idSchema,value);
  return {
    list:()=>invoke<DocumentSummary[]>('list'),
    get:value=>invoke<DocumentDetail>('get',{p_id:id(value)}),
    create:input=>{ const {title,content}=parse(createDocumentSchema,input); return invoke<DocumentDetail>('create',{p_input:{title,content}}); },
    update:(value,input)=>invoke<DocumentDetail>('update',{p_id:id(value),p_input:parse(updateDocumentSchema,input)}),
    remove:async value=>{ await invoke('remove',{p_id:id(value)}); },
    restore:(value,versionId)=>invoke<DocumentDetail>('restore',{p_id:id(value),p_version_id:id(versionId)}),
    listShares:value=>invoke<Share[]>('list_shares',{p_id:id(value)}),
    grantShare:(value,recipient,permission)=>invoke<Share>('grant_share',{p_id:id(value),p_recipient:parse(z.object({persona:personaSchema}).strict(),recipient),p_permission:parse(z.enum(['view','edit']),permission)}),
    revokeShare:async(value,shareId)=>{ await invoke('revoke_share',{p_id:id(value),p_share_id:id(shareId)}); },
    addAttachment:(value,input)=>invoke<Attachment>('add_attachment',{p_id:id(value),p_input:parse(attachmentSchema,input)}),
    heartbeat:(value,input)=>invoke<Presence[]>('heartbeat',{p_id:id(value),p_input:parse(presenceSchema,input)}),
  };
}
