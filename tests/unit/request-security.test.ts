import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { createPreAuthSession, getPreAuthBinding, issueCsrf, requireCsrf, requireSameOrigin, verifyCsrf } from '../../lib/security/csrf';
import { consumeLimit, hashLimitKey, requireLimit, trustedClientIp } from '../../lib/security/rate-limit';
import { createDocumentSchema, updateDocumentSchema, parseJsonBody, presenceSchema, sessionSchema, shareSchema } from '../../lib/security/validation';

const request = (headers: HeadersInit = {}) => new Request('https://attacker-controlled.invalid/api/docs', { method: 'POST', headers });
beforeEach(() => {
  vi.stubEnv('APP_ORIGIN', 'https://docs.example.test');
  vi.stubEnv('CSRF_SECRET', 'a'.repeat(64));
  vi.stubEnv('RATE_LIMIT_SECRET', 'b'.repeat(64));
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('origin and session-bound CSRF protection', () => {
  it('uses the canonical deployment origin independent of Host and request URL', () => {
    expect(() => requireSameOrigin(request({ origin: 'https://docs.example.test', host: 'evil.test' }))).not.toThrow();
    expect(() => requireSameOrigin(request({ origin: 'https://evil.test', host: 'evil.test', 'x-forwarded-host': 'evil.test' }))).toThrow();
  });
  it.each([undefined, 'null', 'https://docs.example.test.evil.test', 'http://docs.example.test', 'https://docs.example.test/path'])('rejects absent or untrusted Origin %s', (origin) => {
    expect(() => requireSameOrigin(request(origin ? { origin } : {}))).toThrow();
  });
  it('rejects cross-site Fetch Metadata even with a canonical Origin', () => {
    expect(() => requireSameOrigin(request({ origin: 'https://docs.example.test', 'sec-fetch-site': 'cross-site' }))).toThrow();
  });
  it('fails closed without the canonical deployment origin', () => {
    vi.stubEnv('APP_ORIGIN', '');
    expect(() => requireSameOrigin(request({ origin: 'https://docs.example.test' }))).toThrow();
  });
  it.each(['https://docs.example.test/other', 'https://user:pass@docs.example.test', 'http://docs.example.test'])('rejects unsafe origin configuration %s', (origin) => {
    vi.stubEnv('APP_ORIGIN', origin);
    expect(() => requireSameOrigin(request({ origin }))).toThrow();
  });
  it('binds tokens to the validated session and expires them without sliding', () => {
    const token = issueCsrf('verified-session:one');
    expect(verifyCsrf('verified-session:one', token)).toBe(true);
    expect(verifyCsrf('verified-session:two', token)).toBe(false);
    expect(verifyCsrf('verified-session:one', token + 'x')).toBe(false);
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(verifyCsrf('verified-session:one', token)).toBe(false);
  });
  it('rejects missing and incorrect mutation tokens', () => {
    const headers = { origin: 'https://docs.example.test' };
    expect(() => requireCsrf(request(headers), 'session:one')).toThrow();
    expect(() => requireCsrf(request({ ...headers, 'x-csrf-token': issueCsrf('session:two') }), 'session:one')).toThrow();
    expect(() => requireCsrf(request({ ...headers, 'x-csrf-token': issueCsrf('session:one') }), 'session:one')).not.toThrow();
  });
  it('issues a signed short-lived HttpOnly preauth cookie and a no-store bootstrap', async () => {
    const session = createPreAuthSession();
    const response = session.response;
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('set-cookie')).toContain('HttpOnly');
    expect(response.headers.get('set-cookie')).toContain('Secure');
    const cookie = response.headers.get('set-cookie')!.split(';')[0];
    const binding = getPreAuthBinding(request({ cookie }));
    const { csrfToken } = await response.json();
    expect(verifyCsrf(binding, csrfToken)).toBe(true);
    expect(() => getPreAuthBinding(request({ cookie: cookie + 'x' }))).toThrow();
    vi.advanceTimersByTime(15 * 60 * 1000 + 1);
    expect(() => getPreAuthBinding(request({ cookie }))).toThrow();
  });
  it('rotates preauth bindings and rejects duplicate cookies and future tokens', async () => {
    const first = createPreAuthSession(); const second = createPreAuthSession();
    const { csrfToken } = await first.response.json();
    expect(verifyCsrf(second.binding, csrfToken)).toBe(false);
    const cookie = first.response.headers.get('set-cookie')!.split(';')[0];
    expect(() => getPreAuthBinding(request({ cookie: `${cookie}; ${cookie}` }))).toThrow();
    vi.setSystemTime(Date.now() - 1);
    expect(verifyCsrf(first.binding, csrfToken)).toBe(false);
  });
});

describe('bounded parsing and strict input schemas', () => {
  function json(body: string, headers: HeadersInit = {}) {
    return new Request('https://docs.example.test/api/docs', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
  }
  it('rejects malformed JSON and unsupported content types with public errors', async () => {
    await expect(parseJsonBody(json('{'), createDocumentSchema)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(parseJsonBody(json('{}', { 'content-type': 'text/plain' }), createDocumentSchema)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
  it('checks declared size before reading and actual stream bytes despite a forged length', async () => {
    await expect(parseJsonBody(json('{}', { 'content-length': '9999' }), createDocumentSchema, 10)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(parseJsonBody(json('{"title":"' + 'a'.repeat(100) + '"}', { 'content-length': '1' }), createDocumentSchema, 32)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    await expect(parseJsonBody(json('{"title":"😀😀😀"}'), createDocumentSchema, 20)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
  });
  it('bounds chunked streams and cancels at the cap', async () => {
    const cancelled = vi.fn(); let reads = 0;
    const stream = new ReadableStream({ pull(controller) { reads++; controller.enqueue(new Uint8Array(100)); }, cancel: cancelled });
    const req = new Request('https://docs.example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    await expect(parseJsonBody(req, createDocumentSchema, 50)).rejects.toMatchObject({ code: 'PAYLOAD_TOO_LARGE' });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(reads).toBeLessThan(4);
  });
  it('rejects malformed lengths, invalid UTF-8, and truncated body streams', async () => {
    await expect(parseJsonBody(json('{}', { 'content-length': '-1' }), createDocumentSchema)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const badUtf8 = new Request('https://docs.example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: new Uint8Array([0xff]) });
    await expect(parseJsonBody(badUtf8, createDocumentSchema)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    const stream = new ReadableStream({ start(controller) { controller.error(new Error('private transport details')); } });
    const truncated = new Request('https://docs.example.test', { method: 'POST', headers: { 'content-type': 'application/json' }, body: stream, duplex: 'half' } as RequestInit);
    await expect(parseJsonBody(truncated, createDocumentSchema)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', message: 'Invalid request body.' });
  });
  it.each(['owner', 'ownerId', 'userId', 'updatedBy'])('rejects spoofed %s identity', async (field) => {
    await expect(parseJsonBody(json(JSON.stringify({ title: 'Safe', [field]: 'victim' })), createDocumentSchema)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(updateDocumentSchema.safeParse({ title: 'Safe', [field]: 'victim' }).success).toBe(false);
  });
  it('normalizes defaults and sanitizes rich document HTML at the boundary', async () => {
    expect(await parseJsonBody(json('{}'), createDocumentSchema)).toMatchObject({ title: 'Untitled', content: '' });
    const parsed = await parseJsonBody(json(JSON.stringify({ title: ' Table ', content: '<script>evil()</script><table><tr><td>safe</td></tr></table>' })), createDocumentSchema);
    expect(parsed.title).toBe('Table'); expect(parsed.content).toContain('<table>'); expect(parsed.content).not.toContain('evil');
  });
  it('rejects content exceeding the UTF-8 HTML budget before sanitization', () => {
    expect(createDocumentSchema.safeParse({ content: '😀'.repeat(262145) }).success).toBe(false);
    expect(updateDocumentSchema.safeParse({}).success).toBe(false);
    expect(updateDocumentSchema.safeParse({ title: ' ' }).success).toBe(false);
  });
  it('keeps identity out of presence, recipients, and guest mode selection', () => {
    expect(presenceSchema.safeParse({ active: true, userId: 'victim' }).success).toBe(false);
    expect(presenceSchema.safeParse({ active: true, cursorY: Infinity }).success).toBe(false);
    expect(shareSchema.safeParse({ userId: 'victim', permission: 'edit' }).success).toBe(false);
    expect(shareSchema.safeParse({ email: 'a@example.test', permission: 'edit' }).success).toBe(true);
    expect(shareSchema.safeParse({ persona: 'alice', permission: 'view' }).success).toBe(true);
    expect(sessionSchema.safeParse({ kind: 'guest', persona: 'alice' }).success).toBe(false);
  });
});

describe('durable limiter boundary', () => {
  it('HMACs identifiers with distinct scopes without returning plaintext', () => {
    const digest = hashLimitKey('email', 'person@example.test');
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    expect(digest).not.toContain('person');
    expect(hashLimitKey('ip', 'person@example.test')).not.toBe(digest);
  });
  it('refuses untrusted forwarding metadata without an explicit deployment contract', () => {
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', '');
    expect(() => trustedClientIp(request({ 'x-forwarded-for': '192.0.2.1' }))).toThrow();
    vi.stubEnv('TRUSTED_CLIENT_IP_HEADER', 'cf-connecting-ip');
    expect(trustedClientIp(request({ 'cf-connecting-ip': '192.0.2.1', 'x-forwarded-for': 'evil' }))).toBe('192.0.2.1');
    expect(() => trustedClientIp(request({ 'cf-connecting-ip': '192.0.2.1, 192.0.2.2' }))).toThrow();
  });
  it('denies expensive work if durable storage is unavailable; never falls back to memory', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ''); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', '');
    await expect(consumeLimit(hashLimitKey('ip', '192.0.2.1'), 'auth')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
  function databaseResponse(body: unknown, status = 200) {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://db.example.test');
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })));
  }
  it('uses database allow/deny decisions and returns public retry metadata', async () => {
    databaseResponse([{ allowed: true, retry_after: 0 }]);
    expect(await consumeLimit(hashLimitKey('session', 'one'), 'mutation')).toEqual({ allowed: true, retryAfter: 0 });
    databaseResponse([{ allowed: false, retry_after: 613 }]);
    expect(await consumeLimit(hashLimitKey('email', 'one@example.test'), 'auth')).toEqual({ allowed: false, retryAfter: 613 });
    await expect(requireLimit(hashLimitKey('session', 'one'), 'upload')).rejects.toMatchObject({ code: 'RATE_LIMITED', options: { retryAfterSeconds: 613 } });
  });
  it.each([[], [{ allowed: true, retry_after: -1 }], [{ allowed: false, retry_after: 0 }], [{ allowed: 'yes', retry_after: 0 }], [{ allowed: true, retry_after: 0 }, { allowed: true, retry_after: 0 }]].map((body) => ({ body })))('fails closed on malformed storage decisions $body', async ({ body }) => {
    databaseResponse(body);
    await expect(consumeLimit(hashLimitKey('session', 'one'), 'auth')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE' });
  });
  it('fails closed for database failures without exposing errors', async () => {
    databaseResponse({ code: 'database-password', message: 'sensitive database details', details: 'private', hint: '' }, 503);
    await expect(consumeLimit(hashLimitKey('session', 'one'), 'auth')).rejects.toMatchObject({ code: 'STORAGE_UNAVAILABLE', message: 'Request protection is temporarily unavailable.' });
  });
});
