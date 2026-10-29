import { describe, expect, it } from 'vitest';
import { ApiError, toErrorResponse } from '../../lib/http/errors';
import type { ErrorCode } from '../../lib/http/errors';

const statuses: [ErrorCode, number][] = [
  ['UNAUTHENTICATED', 401],
  ['VERIFICATION_REQUIRED', 403],
  ['NOT_FOUND', 404],
  ['FORBIDDEN', 403],
  ['SESSION_EXPIRED', 410],
  ['DEMO_RESET', 409],
  ['VALIDATION_ERROR', 400],
  ['PAYLOAD_TOO_LARGE', 413],
  ['RATE_LIMITED', 429],
  ['QUOTA_EXCEEDED', 429],
  ['STORAGE_UNAVAILABLE', 503],
];

describe('toErrorResponse', () => {
  it.each(statuses)('maps %s to HTTP %s without internal details', async (code, status) => {
    const error = new ApiError(code, 'Safe public message');
    error.stack = 'internal stack containing a database credential';
    const response = toErrorResponse(error);
    expect(response.status).toBe(status);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(await response.json()).toEqual({ error: 'Safe public message', code });
  });

  it('gives rate limited callers a default retry interval', () => {
    const response = toErrorResponse(new ApiError('RATE_LIMITED', 'Try again later'));
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('returns the rate limiter retry interval rounded up to whole seconds', () => {
    const response = toErrorResponse(new ApiError('RATE_LIMITED', 'Try again later', { retryAfterSeconds: 4.2 }));
    expect(response.headers.get('retry-after')).toBe('5');
  });

  it.each([0, -3, Number.NaN, Number.POSITIVE_INFINITY])('uses a safe default for invalid retry interval %s', (retryAfterSeconds) => {
    const response = toErrorResponse(new ApiError('RATE_LIMITED', 'Try again later', { retryAfterSeconds }));
    expect(response.headers.get('retry-after')).toBe('60');
  });

  it('does not attach rate retry metadata to a quota error', () => {
    const response = toErrorResponse(new ApiError('QUOTA_EXCEEDED', 'Workspace full'));
    expect(response.headers.has('retry-after')).toBe(false);
  });

  it.each([new Error('database credential is secret'), 'private backend failure', null])('hides unexpected error details', async (error) => {
    const response = toErrorResponse(error);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'Storage is temporarily unavailable.', code: 'STORAGE_UNAVAILABLE' });
  });
});
