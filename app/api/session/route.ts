import { getSessionBinding, getVerifiedUser } from '../../../lib/auth/context';
import { readSelectedMode } from '../../../lib/auth/mode';
import { ApiError, toErrorResponse } from '../../../lib/http/errors';
import { applicationOrigin, createPreAuthSession, getPreAuthBinding, issueCsrf, requireCsrf } from '../../../lib/security/csrf';
import { hashLimitKey, requireLimit, trustedClientIp } from '../../../lib/security/rate-limit';
import { parseJsonBody, sessionSchema } from '../../../lib/security/validation';
import { createServerSupabaseClient } from '../../../lib/supabase/server';
import { getTemporaryCredential, startTemporarySession, temporarySessionBinding } from '../../../lib/temporary/sessions';

const privateHeaders={'Cache-Control':'private, no-store','Vary':'Cookie'};
function privateResponse(response:Response):Response { for (const [k,v] of Object.entries(privateHeaders)) response.headers.set(k,v); return response; }

/** Safe metadata + context-bound CSRF. No cookie, hash or repository is serialized. */
export async function GET(request:Request):Promise<Response> {
  try {
    if (request.headers.get('sec-fetch-site')==='cross-site' || (request.headers.has('origin') && request.headers.get('origin')!==applicationOrigin())) throw new ApiError('FORBIDDEN','Request origin is not allowed.');
    const mode=await readSelectedMode();
    if (mode==='guest'||mode==='demo') {
      const credential=await getTemporaryCredential(undefined,{refreshCookie:true});
      if (credential) return Response.json({serverNow:new Date().toISOString(),session:credential.actor,csrfToken:issueCsrf(await temporarySessionBinding(credential))},{headers:privateHeaders});
    } else {
      const user=await getVerifiedUser();
      const binding=await getSessionBinding();
      if (user && binding) {
        const client=await createServerSupabaseClient();
        const {data:profile,error}=await client.from('profiles').select('display_name,email').eq('id',user.userId).single();
        if (error||!profile) throw new ApiError('STORAGE_UNAVAILABLE','Storage is temporarily unavailable.');
        return Response.json({serverNow:new Date().toISOString(),session:{kind:'user',userId:user.userId,displayName:profile.display_name,email:profile.email},csrfToken:issueCsrf(binding)},{headers:privateHeaders});
      }
      // Unverified accounts can still sign out or select a temporary mode safely.
      if (binding) return Response.json({serverNow:new Date().toISOString(),session:null,csrfToken:issueCsrf(binding)},{headers:privateHeaders});
    }
    await requireLimit(hashLimitKey('session-ip',trustedClientIp(request)),'session');
    const bootstrap=createPreAuthSession();
    return privateResponse(Response.json({serverNow:new Date().toISOString(),session:null,csrfToken:issueCsrf(bootstrap.binding)},{headers:bootstrap.response.headers}));
  } catch(error) {
    if (error instanceof ApiError && (error.code==='SESSION_EXPIRED'||error.code==='DEMO_RESET')) {
      const bootstrap=createPreAuthSession();
      const errorResponse=toErrorResponse(error);
      return privateResponse(Response.json({serverNow:new Date().toISOString(),session:null,csrfToken:issueCsrf(bootstrap.binding),error:error.message,code:error.code},{status:errorResponse.status,headers:bootstrap.response.headers}));
    }
    return privateResponse(toErrorResponse(error));
  }
}
export async function POST(request:Request):Promise<Response> {
  try {
    const mode=await readSelectedMode();
    let binding:string|null=null;
    if (mode==='guest'||mode==='demo') {
      try { const credential=await getTemporaryCredential(); if(credential) binding=await temporarySessionBinding(credential); }
      catch(error) { if(!(error instanceof ApiError)||!['SESSION_EXPIRED','DEMO_RESET'].includes(error.code)) throw error; }
    } else binding=await getSessionBinding();
    requireCsrf(request,binding??getPreAuthBinding(request));
    await requireLimit(hashLimitKey('session-ip',trustedClientIp(request)),'session');
    const input=await parseJsonBody(request,sessionSchema);
    const actor=await startTemporarySession(input.kind,input.kind==='demo'?input.persona:undefined);
    const credential=await getTemporaryCredential();
    if(!credential) throw new ApiError('STORAGE_UNAVAILABLE','Storage is temporarily unavailable.');
    return Response.json({serverNow:new Date().toISOString(),session:actor,csrfToken:issueCsrf(await temporarySessionBinding(credential))},{status:201,headers:privateHeaders});
  } catch(error) { return privateResponse(toErrorResponse(error)); }
}
