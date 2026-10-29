import { claimGuestWorkspace } from '../../../../lib/temporary/claim';
import { toErrorResponse } from '../../../../lib/http/errors';
export async function POST(request:Request):Promise<Response> {
 let response:Response;
 try {response=Response.json(await claimGuestWorkspace(request));}
 catch(error){response=toErrorResponse(error);}
 response.headers.set('Cache-Control','private, no-store');response.headers.set('Vary','Cookie');
 return response;
}
