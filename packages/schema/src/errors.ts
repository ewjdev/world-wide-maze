/** HTTP API error codes (contracts §7) as a runtime list. The type is `ApiErrorCode` in types.ts. */
import type { ApiErrorCode } from './types.ts';

export const API_ERROR_CODES = [
  'CAPTURE_BLOCKED',
  'CAPTURE_TIMEOUT',
  'URL_FORBIDDEN',
  'BUILD_FAILED',
  'UNPLAYABLE',
  'RATE_LIMITED',
] as const satisfies readonly ApiErrorCode[];

export function isApiErrorCode(x: unknown): x is ApiErrorCode {
  return typeof x === 'string' && (API_ERROR_CODES as readonly string[]).includes(x);
}
