import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createServerSupabaseClient } from '../supabase/server';
import { ApiError } from '../http/errors';

/** Auth performs network verification; current protected DB state can revoke old JWTs. */
export async function verifiedUserFromClient(client: SupabaseClient): Promise<{ userId: string } | null> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user || !user.email_confirmed_at) return null;
  const result = await client.rpc('is_verified_user');
  if (result.error) throw new ApiError('STORAGE_UNAVAILABLE', 'Authentication is temporarily unavailable.');
  return result.data === true ? { userId: user.id } : null;
}
export async function getVerifiedUser(): Promise<{ userId: string } | null> {
  return verifiedUserFromClient(await createServerSupabaseClient());
}

/** Use session data only AFTER getUser validates it. Session IDs separate concurrent logins. */
export async function sessionBindingFromClient(client: SupabaseClient): Promise<string | null> {
  const { data: { user }, error } = await client.auth.getUser();
  if (error || !user) return null;
  const { data: { session }, error: sessionError } = await client.auth.getSession();
  if (sessionError || !session) return null;
  try {
    const claims = JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString('utf8'));
    if (claims.sub !== user.id || typeof claims.session_id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(claims.session_id)) return null;
    return `auth:${user.id}:${claims.session_id}`;
  } catch { return null; }
}
export async function getSessionBinding(): Promise<string | null> {
  return sessionBindingFromClient(await createServerSupabaseClient());
}

import type { RequestContext } from './types';
import { readSelectedMode } from './mode';
import { createPersistentStore } from '../documents/repository';
import { createRecipientResolver } from '../sharing/recipients';
import { createTemporaryStore } from '../temporary/repository';
import { getTemporaryCredential, temporarySessionBinding } from '../temporary/sessions';

/** Internal capabilities are never returned as HTTP JSON. */
export interface AuthorizedRequestContext extends RequestContext {
  csrfBinding: string;
  resolveRecipient?: (documentId:string,email:string)=>Promise<{userId:string}|null>;
}
export async function requireContext(request:Request):Promise<AuthorizedRequestContext> {
  const mode=await readSelectedMode();
  if(mode==='guest'||mode==='demo') {
    const credential=await getTemporaryCredential();
    if(!credential) throw new ApiError('UNAUTHENTICATED','Select a valid session to continue.');
    let generation=credential.actor.generation;
    if(!['GET','HEAD'].includes(request.method.toUpperCase())) {
      const value=request.headers.get('x-workspace-generation')??'';
      generation=Number(value);
      if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(generation)||generation>2147483647) throw new ApiError('VALIDATION_ERROR','A valid workspace generation is required.');
      // NEVER replace the request's expected generation with freshly validated metadata.
    }
    return {actor:credential.actor,store:createTemporaryStore(credential,generation),csrfBinding:await temporarySessionBinding(credential)};
  }
  const client=await createServerSupabaseClient();
  const user=await verifiedUserFromClient(client);
  if(!user) {
    const binding=await sessionBindingFromClient(client);
    throw new ApiError(binding?'VERIFICATION_REQUIRED':'UNAUTHENTICATED',binding?'Verify your account to continue.':'Sign in to continue.');
  }
  const csrfBinding=await sessionBindingFromClient(client);
  if(!csrfBinding) throw new ApiError('UNAUTHENTICATED','Sign in to continue.');
  return {actor:{kind:'user',userId:user.userId},store:createPersistentStore(client),csrfBinding,resolveRecipient:(documentId,email)=>createRecipientResolver(client,documentId)(email)};
}
