import { z } from 'zod';
import { requireContext } from '@/lib/auth/context';
import { DOCUMENT_REQUEST_BYTES, parseJsonBody, restoreDocumentSchema, updateDocumentSchema } from '@/lib/security/validation';
import { cleanDocument, documentId, endpoint, json, mutationContext, type DocumentParams } from '../_shared';
export async function GET(request:Request,{params}:DocumentParams):Promise<Response> {return endpoint(async()=>{const {store}=await requireContext(request); return json(cleanDocument(await store.get(documentId((await params).id))));});}
export async function PATCH(request:Request,{params}:DocumentParams):Promise<Response> {return endpoint(async()=>{const {store}=await mutationContext(request); const id=documentId((await params).id); const input=await parseJsonBody(request,z.union([restoreDocumentSchema,updateDocumentSchema]),DOCUMENT_REQUEST_BYTES); return json(cleanDocument('restoreVersionId' in input?await store.restore(id,input.restoreVersionId):await store.update(id,input)));});}
export async function DELETE(request:Request,{params}:DocumentParams):Promise<Response> {return endpoint(async()=>{const {store}=await mutationContext(request); await store.remove(documentId((await params).id)); return json({success:true});});}
