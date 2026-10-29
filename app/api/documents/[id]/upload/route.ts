import { randomUUID } from 'node:crypto';
import { ApiError } from '@/lib/http/errors';
import { parseImport } from '@/lib/import/parse';
import { sanitizeDocumentHtml } from '@/lib/security/html';
import { boundedUpload, documentId, endpoint, json, mutationContext, type DocumentParams } from '../../_shared';
export const runtime='nodejs';
export async function POST(request:Request,{params}:DocumentParams):Promise<Response> {return endpoint(async()=>{const {store}=await mutationContext(request,'upload'); const id=documentId((await params).id); const doc=await store.get(id); if(!doc.permissions.allowedOperations.includes('upload')) throw new ApiError('FORBIDDEN','This operation is not allowed.'); const file=await boundedUpload(request); const html=sanitizeDocumentHtml(await parseImport({name:file.name,mimeType:file.type,bytes:new Uint8Array(await file.arrayBuffer())})); const attachment=await store.addAttachment(id,{filename:file.name,mimeType:file.type||'application/octet-stream',sizeBytes:file.size,url:`/attachments/${randomUUID()}`}); return json({success:true,filename:file.name,html,attachment,message:'File imported successfully.'});});}
