import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { z } from 'zod';
import type { Actor, DemoPersona } from '../auth/types';
import { clearSelectedMode, readSelectedMode, setSelectedMode } from '../auth/mode';
import { ApiError, type ErrorCode } from '../http/errors';
import { applicationOrigin } from '../security/csrf';
import { createAdminSupabaseClient } from '../supabase/admin';

type TemporaryActor = Exclude<Actor, { kind: 'user' }>;
declare const validatedCredential: unique symbol;
/** Server-only capability. Never put this object in a Response or client props. */
export type TemporaryCredential = Readonly<{ tokenHash: string; actor: TemporaryActor; [validatedCredential]: true }>;
const base = { workspaceId: z.uuid(), sessionId: z.uuid(), generation: z.number().int().positive(), expiresAt: z.string().datetime({ offset: true }) };
const actorSchema = z.discriminatedUnion('kind', [z.object({ ...base, kind: z.literal('guest') }).strict(),z.object({ ...base, kind: z.literal('demo'), persona: z.enum(['alice','bob','charlie']) }).strict()]);
const knownErrors: Partial<Record<ErrorCode,string>> = {
  VERIFICATION_REQUIRED: 'Verify your account to continue.', SESSION_EXPIRED: 'This session has expired.', DEMO_RESET: 'This demo workspace has reset. Please refresh.',
  FORBIDDEN: 'This operation is not allowed.', NOT_FOUND: 'Document not found.',
  VALIDATION_ERROR: 'Invalid request.', QUOTA_EXCEEDED: 'The temporary workspace limit has been reached.',
};
export async function temporaryRpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  try {
    const { data,error } = await createAdminSupabaseClient().rpc(name,args);
    if (error) {
      const code = error.message as ErrorCode;
      if (knownErrors[code]) throw new ApiError(code,knownErrors[code]!);
      throw new ApiError('STORAGE_UNAVAILABLE','Storage is temporarily unavailable.');
    }
    return data as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('STORAGE_UNAVAILABLE','Storage is temporarily unavailable.');
  }
}
function safeActor(value: unknown): TemporaryActor {
  const parsed = actorSchema.safeParse(value);
  if (!parsed.success) throw new ApiError('STORAGE_UNAVAILABLE','Storage is temporarily unavailable.');
  return parsed.data;
}
export function temporaryCookieName(kind: 'guest' | 'demo'): string {
  return `${applicationOrigin().startsWith('https:')?'__Host-':''}ai-docs-${kind}`;
}
function cookieSettings() { return { path:'/', httpOnly:true, secure:applicationOrigin().startsWith('https:'), sameSite:'lax' as const }; }
async function rawCookie(kind: 'guest' | 'demo'): Promise<string | null> {
  const values = (await cookies()).getAll().filter(c => c.name === temporaryCookieName(kind));
  if (values.length !== 1 || !/^[A-Za-z0-9_-]{43}$/.test(values[0].value)) return null;
  const raw = values[0].value;
  return Buffer.from(raw,'base64url').toString('base64url') === raw ? raw : null;
}
const hash = (raw: string) => createHash('sha256').update(raw).digest('hex');
async function writeCookie(kind: 'guest'|'demo', raw: string, actor: TemporaryActor) {
  const settings = kind==='guest' ? { expires:new Date(actor.expiresAt) } : { maxAge:24*60*60 };
  (await cookies()).set(temporaryCookieName(kind),raw,{...cookieSettings(),...settings});
}
/** Explicit kind is reserved for an authorized retained-guest claim, never context fallback. */
export async function getTemporaryCredential(kind?: 'guest'|'demo', options: { refreshCookie?: boolean } = {}): Promise<TemporaryCredential | null> {
  const mode = kind ?? await readSelectedMode();
  if (mode !== 'guest' && mode !== 'demo') return null;
  const raw = await rawCookie(mode);
  if (!raw) return null;
  const tokenHash = hash(raw);
  const actor = safeActor(await temporaryRpc('temporary_session',{p_token_hash:tokenHash}));
  if (actor.kind !== mode) throw new ApiError('SESSION_EXPIRED','This session has expired.');
  // Next cookies may be written only in routes/actions, never implicit Server Components.
  if (options.refreshCookie && mode==='demo') await writeCookie(mode,raw,actor);
  return { tokenHash,actor } as TemporaryCredential;
}
export async function getTemporarySession(): Promise<TemporaryActor | null> {
  return (await getTemporaryCredential())?.actor ?? null;
}
export async function startTemporarySession(kind:'guest'|'demo', persona?: DemoPersona): Promise<TemporaryActor> {
  if (!['guest','demo'].includes(kind) || (kind==='guest' && persona!==undefined) || (kind==='demo' && !['alice','bob','charlie'].includes(persona ?? ''))) throw new ApiError('VALIDATION_ERROR','Invalid session.');
  const previous = await rawCookie(kind);
  const raw = randomBytes(32).toString('base64url');
  const actor = safeActor(await temporaryRpc('temporary_start',{p_token_hash:hash(raw),p_kind:kind,p_persona:persona??null}));
  if (actor.kind!==kind) throw new ApiError('STORAGE_UNAVAILABLE','Storage is temporarily unavailable.');
  // A mode transition creates a new opaque credential. The other mode's cookie
  // remains independent; real login never consumes or implicitly claims guest data.
  if (previous) await temporaryRpc('temporary_end',{p_token_hash:hash(previous)});
  await writeCookie(kind,raw,actor);
  await setSelectedMode(kind);
  return actor;
}
export async function switchDemoPersona(persona: DemoPersona, expectedGeneration?: number): Promise<TemporaryActor> {
  if (!['alice','bob','charlie'].includes(persona)) throw new ApiError('VALIDATION_ERROR','Invalid persona.');
  const credential=await getTemporaryCredential();
  if (!credential) throw new ApiError('UNAUTHENTICATED','A session is required.');
  if (credential.actor.kind!=='demo') throw new ApiError('FORBIDDEN','Guests cannot switch personas.');
  const generation=expectedGeneration??credential.actor.generation;
  if (!Number.isSafeInteger(generation)||generation<1) throw new ApiError('VALIDATION_ERROR','A valid workspace generation is required.');
  return safeActor(await temporaryRpc('temporary_persona',{p_token_hash:credential.tokenHash,p_expected_generation:generation,p_persona:persona}));
}
export async function endTemporarySession(): Promise<void> {
  const mode=await readSelectedMode();
  if (mode!=='guest'&&mode!=='demo') return;
  const raw=await rawCookie(mode);
  if (raw) await temporaryRpc('temporary_end',{p_token_hash:hash(raw)});
  (await cookies()).set(temporaryCookieName(mode),'',{...cookieSettings(),maxAge:0});
  await clearSelectedMode();
}

/** CSRF binds to the selected validated context; retained guest cookies are not a fallback. */
export async function temporarySessionBinding(credential: TemporaryCredential): Promise<string> {
  return `temporary:${credential.tokenHash}`;
}

/** Retained proof only for verified explicit claims; SQL validates source or receipt. */
export async function retainedGuestTokenHash():Promise<string|null> {
 const raw=await rawCookie('guest');return raw?hash(raw):null;
}
