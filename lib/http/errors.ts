export type ErrorCode =
  | 'UNAUTHENTICATED'
  | 'VERIFICATION_REQUIRED'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'SESSION_EXPIRED'
  | 'DEMO_RESET'
  | 'VALIDATION_ERROR'
  | 'PAYLOAD_TOO_LARGE'
  | 'RATE_LIMITED'
  | 'QUOTA_EXCEEDED'
  | 'STORAGE_UNAVAILABLE';

const statusByCode: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  VERIFICATION_REQUIRED: 403,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  SESSION_EXPIRED: 410,
  DEMO_RESET: 409,
  VALIDATION_ERROR: 400,
  PAYLOAD_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  STORAGE_UNAVAILABLE: 503,
};

/** Messages must be safe for public API responses; never pass database details. */
export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly options: { retryAfterSeconds?: number } = {},
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function toErrorResponse(error: unknown): Response {
  const publicError = error instanceof ApiError
    ? error
    : new ApiError('STORAGE_UNAVAILABLE', 'Storage is temporarily unavailable.');
  const headers = new Headers();

  if (publicError.code === 'RATE_LIMITED') {
    const seconds = publicError.options.retryAfterSeconds;
    const retryAfter = typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0
      ? Math.ceil(seconds)
      : 60;
    headers.set('Retry-After', String(retryAfter));
  }

  return Response.json(
    { error: publicError.message, code: publicError.code },
    { status: statusByCode[publicError.code], headers },
  );
}
