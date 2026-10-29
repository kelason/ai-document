import { requireContext, type AuthorizedRequestContext } from '@/lib/auth/context';
import { ApiError, toErrorResponse } from '@/lib/http/errors';
import { requireCsrf } from '@/lib/security/csrf';
import { hashLimitKey, requireLimit, type LimitBucket } from '@/lib/security/rate-limit';
import { idSchema, UPLOAD_BYTES } from '@/lib/security/validation';
import { sanitizeDocumentHtml } from '@/lib/security/html';
import type { DocumentDetail } from '@/lib/documents/types';
export type DocumentParams={params:Promise<{id:string}>};
export function privateResponse(response:Response):Response {response.headers.set('Cache-Control','private, no-store'); response.headers.set('Vary','Cookie'); return response;}
export function json(value:unknown,status=200):Response {return privateResponse(Response.json(value,{status}));}
export function endpoint(operation:()=>Promise<Response>):Promise<Response> {return operation().then(privateResponse).catch(error=>privateResponse(toErrorResponse(error)));}
export async function mutationContext(request:Request,bucket:LimitBucket='mutation'):Promise<AuthorizedRequestContext> {const context=await requireContext(request); requireCsrf(request,context.csrfBinding); await requireLimit(hashLimitKey(`document-${bucket}`,context.csrfBinding),bucket); return context;}
export function documentId(value:string):string {const result=idSchema.safeParse(value); if(!result.success) throw new ApiError('VALIDATION_ERROR','Invalid document identifier.'); return result.data;}
export function cleanDocument(doc:DocumentDetail):DocumentDetail {return {...doc,content:sanitizeDocumentHtml(doc.content),history:doc.history.map(version=>({...version,content:sanitizeDocumentHtml(version.content)}))};}
/** Read the actual stream under a hard budget before the multipart decoder buffers it. */
export async function boundedUpload(request:Request):Promise<File> {
  const invalid=()=>new ApiError('VALIDATION_ERROR','Upload one supported file using multipart/form-data.');
  const tooLarge=()=>new ApiError('PAYLOAD_TOO_LARGE','Upload request exceeds 5 MiB.');
  const type=request.headers.get('content-type')??'';
  if(!/^multipart\/form-data\s*;\s*boundary=/i.test(type)||(request.headers.get('content-encoding')??'identity').toLowerCase()!=='identity') throw invalid();
  const length=request.headers.get('content-length'); if(length!==null){if(!/^\d+$/.test(length)) throw invalid(); if(BigInt(length)>BigInt(UPLOAD_BYTES)) throw tooLarge();}
  if(!request.body) throw invalid(); const reader=request.body.getReader(); const chunks:Uint8Array[]=[]; let size=0;
  try {while(true){const {done,value}=await reader.read(); if(done) break; size+=value.byteLength; if(size>UPLOAD_BYTES){await reader.cancel().catch(()=>undefined); throw tooLarge();} chunks.push(value);}} catch(error){if(error instanceof ApiError) throw error; throw invalid();} finally{reader.releaseLock();}
  try {const form=await new Response(Buffer.concat(chunks),{headers:{'content-type':type}}).formData(); const entries=[...form.entries()]; if(entries.length!==1||entries[0][0]!=='file'||typeof entries[0][1]==='string') throw invalid(); return entries[0][1];} catch(error){if(error instanceof ApiError) throw error; throw invalid();}
}
