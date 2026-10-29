import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { ApiError } from '../http/errors';
import { applicationOrigin } from '../security/csrf';

export type SessionMode = 'user' | 'guest' | 'demo';
const lifetime = 30 * 24 * 60 * 60;
export function selectedModeCookieName(): string {
  return applicationOrigin().startsWith('https:') ? '__Host-ai-docs-mode' : 'ai-docs-mode';
}
function signature(value: string): string {
  const secret = process.env.CSRF_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new ApiError('STORAGE_UNAVAILABLE', 'Application security configuration is unavailable.');
  return createHmac('sha256', secret).update(JSON.stringify(['session-mode-v1', value])).digest('hex');
}
function settings() { return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure: applicationOrigin().startsWith('https:'), maxAge: lifetime }; }

/** Selection is never authority: auth and temporary credentials are independently validated. */
export async function readSelectedMode(request?: Request): Promise<SessionMode | null> {
  const name = selectedModeCookieName();
  const values = request
    ? (request.headers.get('cookie') ?? '').split(';').map(p => p.trim()).filter(p => p.startsWith(`${name}=`)).map(p => p.slice(name.length + 1))
    : (await cookies()).getAll().filter(p => p.name === name).map(p => p.value);
  if (values.length !== 1 || values[0].length > 150) return null;
  const [mode, expires, signed, extra] = values[0].split('.');
  if (extra !== undefined || !['user', 'guest', 'demo'].includes(mode) || !/^\d{10,13}$/.test(expires) || Number(expires) <= Date.now() || Number(expires) > Date.now() + lifetime * 1000 || !/^[a-f0-9]{64}$/.test(signed ?? '')) return null;
  const expected = signature(`${mode}.${expires}`);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signed))) return null;
  return mode as SessionMode;
}
export async function setSelectedMode(mode: SessionMode): Promise<void> {
  if (!['user', 'guest', 'demo'].includes(mode)) throw new ApiError('VALIDATION_ERROR', 'Invalid session mode.');
  const value = `${mode}.${Date.now() + lifetime * 1000}`;
  (await cookies()).set(selectedModeCookieName(), `${value}.${signature(value)}`, settings());
}
export async function clearSelectedMode(): Promise<void> {
  (await cookies()).set(selectedModeCookieName(), '', { ...settings(), maxAge: 0 });
}
