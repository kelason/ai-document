import { requireContext } from '@/lib/auth/context';
import { ApiError } from '@/lib/http/errors';
import { parseJsonBody, shareSchema } from '@/lib/security/validation';
import { documentId, endpoint, json, mutationContext, type DocumentParams } from '../../_shared';
export async function GET(request:Request,{params}:DocumentParams):Promise<Response> {return endpoint(async()=>json(await (await requireContext(request)).store.listShares(documentId((await params).id))));}
export async function POST(request:Request,{params}:DocumentParams):Promise<Response> {return endpoint(async()=>{const context=await mutationContext(request); const id=documentId((await params).id); if(context.actor.kind==='guest') throw new ApiError('FORBIDDEN','Guests cannot share documents.'); const input=await parseJsonBody(request,shareSchema); const doc=await context.store.get(id); if(!doc.permissions.allowedOperations.includes('manage-shares')) throw new ApiError('FORBIDDEN','Only the owner can share this document.');
  if(context.actor.kind==='demo'){if(!('persona' in input)) throw new ApiError('VALIDATION_ERROR','Choose a demo persona.'); return json(await context.store.grantShare(id,{persona:input.persona},input.permission),201);}
  if(!('email' in input)||!context.resolveRecipient) throw new ApiError('VALIDATION_ERROR','Enter a recipient email.'); const recipient=await context.resolveRecipient(id,input.email); if(!recipient) throw new ApiError('VALIDATION_ERROR','Recipient is unavailable.'); return json(await context.store.grantShare(id,recipient,input.permission),201);
});}
