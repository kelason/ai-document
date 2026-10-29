import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from '../http/errors';

const LIFETIME_SECONDS = 15 * 60;

/** Never derive the trusted origin from Host, Forwarded, or the incoming URL. */
export function applicationOrigin(): string {
  try {
    const configured = process.env.APP_ORIGIN;
    if (!configured) throw new Error();
    const url = new URL(configured);
    if (url.username || url.password || url.search || url.hash || url.pathname !== '/' || !['https:', 'http:'].includes(url.protocol)) throw new Error();
    if (url.protocol !== 'https:' && (process.env.NODE_ENV === 'production' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error();
    return url.origin;
  } catch {
    throw new ApiError('STORAGE_UNAVAILABLE', 'Application security configuration is unavailable.');
  }
}

export function requireSameOrigin(request: Request): void {
  const expected = applicationOrigin();
  const origin = request.headers.get('origin');
  if (origin !== expected || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError('FORBIDDEN', 'Request origin is not allowed.');
  }
}

function sign(purpose: string, binding: string, value: string): string {
  const secret = process.env.CSRF_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32) throw new ApiError('STORAGE_UNAVAILABLE', 'Application security configuration is unavailable.');
  return createHmac('sha256', secret).update(JSON.stringify([purpose, binding, value])).digest('hex');
}
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
function fresh(timestamp: string): boolean {
  if (!/^\d{10,13}$/.test(timestamp)) return false;
  const age = Date.now() - Number(timestamp);
  return age >= 0 && age <= LIFETIME_SECONDS * 1000;
}
function randomValue(): string { return `${Date.now()}.${randomBytes(32).toString('hex')}`; }

/** binding MUST come from a validated auth session (including session ID), temporary credential, or preauth cookie. */
export function issueCsrf(binding: string): string {
  if (!binding || binding.length > 4096) throw new ApiError('FORBIDDEN', 'A valid session binding is required.');
  const value = randomValue();
  return `${value}.${sign('csrf', binding, value)}`;
}
export function verifyCsrf(binding: string, token: string): boolean {
  if (!binding || binding.length > 4096 || typeof token !== 'string' || token.length > 200) return false;
  const [timestamp, nonce, signature, extra] = token.split('.');
  if (extra !== undefined || !timestamp || !nonce || !signature || !fresh(timestamp) || !/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature)) return false;
  return equal(sign('csrf', binding, `${timestamp}.${nonce}`), signature);
}

export function requireCsrf(request: Request, binding: string): void {
  requireSameOrigin(request);
  if (!verifyCsrf(binding, request.headers.get('x-csrf-token') ?? '')) throw new ApiError('FORBIDDEN', 'A valid CSRF token is required.',{csrfRefreshRequired:true});
}

export function csrfResponse(binding: string): Response {
  return Response.json({ csrfToken: issueCsrf(binding) }, { headers: { 'Cache-Control': 'no-store', 'Vary': 'Cookie' } });
}

export function preAuthCookieName(): string {
  return applicationOrigin().startsWith('https:') ? '__Host-ai-docs-preauth' : 'ai-docs-preauth';
}

/** Entry bootstrap. Call again on mode transitions; remove the cookie on login. It grants no document access. */
export function createPreAuthSession(): { binding: string; response: Response } {
  const value = randomValue();
  const signed = `${value}.${sign('preauth', '', value)}`;
  const binding = `preauth:${signed}`;
  const response = csrfResponse(binding);
  const secure = applicationOrigin().startsWith('https:') ? '; Secure' : '';
  response.headers.append('Set-Cookie', `${preAuthCookieName()}=${signed}; Path=/; Max-Age=${LIFETIME_SECONDS}; HttpOnly; SameSite=Strict${secure}`);
  return { binding, response };
}

export function getPreAuthBinding(request: Request): string {
  const name = preAuthCookieName();
  const values = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) throw new ApiError('FORBIDDEN', 'A valid entry session is required.');
  const value = values[0].slice(name.length + 1);
  const [timestamp, nonce, signature, extra] = value.split('.');
  if (value.length > 200 || extra !== undefined || !timestamp || !nonce || !signature || !fresh(timestamp) || !/^[a-f0-9]{64}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(signature) || !equal(sign('preauth', '', `${timestamp}.${nonce}`), signature)) {
    throw new ApiError('FORBIDDEN', 'A valid entry session is required.');
  }
  return `preauth:${value}`;
}
