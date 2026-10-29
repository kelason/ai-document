import 'server-only';
import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { createClient } from '@supabase/supabase-js';
import { ApiError } from '../http/errors';

export type LimitBucket = 'session' | 'auth' | 'mutation' | 'upload' | 'presence';
export interface LimitResult { allowed: boolean; retryAfter: number }
const unavailable = () => new ApiError('STORAGE_UNAVAILABLE', 'Request protection is temporarily unavailable.');

/** Scope separation prevents an IP, email, or session identifier sharing one bucket key. */
export function hashLimitKey(scope: string, value: string): string {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32 || !scope || !value) throw unavailable();
  return createHmac('sha256', secret).update(JSON.stringify([scope, value])).digest('hex');
}

/** Deployment MUST overwrite the chosen header and block direct origin access. No generic Forwarded/XFF fallback. */
export function trustedClientIp(request: Request): string {
  const header = process.env.TRUSTED_CLIENT_IP_HEADER?.toLowerCase();
  if (!header || !['cf-connecting-ip', 'x-vercel-forwarded-for', 'x-real-ip'].includes(header)) throw unavailable();
  const ip = request.headers.get(header)?.trim();
  if (!ip || !isIP(ip)) throw unavailable();
  // Canonicalize IPv6 spelling so equivalent addresses cannot multiply a budget.
  return isIP(ip) === 6 ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip;
}

/** Atomic, shared PostgreSQL state only. Never accept raw identities or add an in-memory fallback. */
export async function consumeLimit(key: string, bucket: LimitBucket): Promise<LimitResult> {
  if (!/^[a-f0-9]{64}$/.test(key) || !['session', 'auth', 'mutation', 'upload', 'presence'].includes(bucket)) throw new ApiError('VALIDATION_ERROR', 'Invalid request limit key.');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !secret) throw unavailable();
  try {
    const client = createClient(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data, error } = await client.rpc('consume_request_limit', { p_key_hash: key, p_bucket: bucket });
    const result = Array.isArray(data) && data.length === 1 ? data[0] : null;
    if (error || !result || typeof result.allowed !== 'boolean' || !Number.isSafeInteger(result.retry_after) || result.retry_after < 0 || (!result.allowed && result.retry_after < 1)) throw unavailable();
    return { allowed: result.allowed, retryAfter: result.retry_after };
  } catch { throw unavailable(); }
}

export async function requireLimit(key: string, bucket: LimitBucket): Promise<void> {
  const result = await consumeLimit(key, bucket);
  if (!result.allowed) throw new ApiError('RATE_LIMITED', 'Too many requests. Please try again later.', { retryAfterSeconds: result.retryAfter });
}
