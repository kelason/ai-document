import { ApiError, toErrorResponse } from '../../../../lib/http/errors';
import { issueCsrf, requireCsrf } from '../../../../lib/security/csrf';
import { hashLimitKey, requireLimit } from '../../../../lib/security/rate-limit';
import { parseJsonBody, personaChangeSchema } from '../../../../lib/security/validation';
import { getTemporaryCredential, switchDemoPersona, temporarySessionBinding } from '../../../../lib/temporary/sessions';

const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie'};
export async function POST(request:Request):Promise<Response> {
  try {
    const credential=await getTemporaryCredential();
    if(!credential) throw new ApiError('UNAUTHENTICATED','A session is required.');
    const binding=await temporarySessionBinding(credential);
    requireCsrf(request,binding);
    const value=request.headers.get('x-workspace-generation')??'';
    const generation=Number(value);
    if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(generation)) throw new ApiError('VALIDATION_ERROR','A valid workspace generation is required.');
    await requireLimit(hashLimitKey('temporary-mutation',credential.tokenHash),'mutation');
    const {persona}=await parseJsonBody(request,personaChangeSchema);
    const actor=await switchDemoPersona(persona,generation);
    return Response.json({serverNow:new Date().toISOString(),session:actor,csrfToken:issueCsrf(binding)},{headers:privateHeaders});
  } catch(error) {
    const response=toErrorResponse(error); for(const [k,v] of Object.entries(privateHeaders)) response.headers.set(k,v); return response;
  }
}
