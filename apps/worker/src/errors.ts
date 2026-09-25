import type { ApiError, ApiErrorCode } from '@wwm/schema';

/** HTTP status used when an `ApiErrorCode` is returned synchronously (SSE errors carry only the code). */
export const ERROR_STATUS: Record<ApiErrorCode, number> = {
  URL_FORBIDDEN: 400,
  CAPTURE_BLOCKED: 422,
  CAPTURE_TIMEOUT: 504,
  BUILD_FAILED: 500,
  UNPLAYABLE: 422,
  RATE_LIMITED: 429,
};

/** A failure with a contract error code (contracts §7). Anything else is reported as BUILD_FAILED. */
export class ServiceError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = 'ServiceError';
  }

  toJSON(): ApiError {
    return { code: this.code, message: this.message };
  }
}

export function toServiceError(e: unknown, fallback: ApiErrorCode = 'BUILD_FAILED'): ServiceError {
  if (e instanceof ServiceError) return e;
  const msg = e instanceof Error ? e.message : String(e);
  return new ServiceError(fallback, msg.slice(0, 500));
}

/** JSON error response `{code, message}` with the mapped status (and `Retry-After` for RATE_LIMITED). */
export function errorResponse(err: ServiceError): Response {
  const headers: Record<string, string> = { 'cache-control': 'no-store' };
  if (err.retryAfterSec !== undefined)
    headers['retry-after'] = String(Math.max(1, Math.ceil(err.retryAfterSec)));
  return Response.json(err.toJSON(), { status: ERROR_STATUS[err.code], headers });
}
