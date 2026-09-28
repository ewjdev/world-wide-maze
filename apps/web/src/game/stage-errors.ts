import type { ApiErrorCode } from '@wwm/schema';

export type LoadErrorCode = ApiErrorCode | 'NETWORK' | 'NOT_FOUND';
export class StageLoadError extends Error {
  constructor(
    readonly code: LoadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'StageLoadError';
  }
}
