import { parseJsonBody, presenceSchema } from '@/lib/security/validation';
import { documentId, endpoint, json, mutationContext, type DocumentParams } from '../../_shared';
export async function POST(request:Request,{params}:DocumentParams):Promise<Response> {return endpoint(async()=>{const {store}=await mutationContext(request,'presence'); const id=documentId((await params).id); const input=await parseJsonBody(request,presenceSchema); return json({activeUsers:await store.heartbeat(id,input)});});}
