import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'X-Request-ID';
export const REQUEST_ID_MAX_LENGTH = 64;

const CANONICAL_REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CanonicalRequestState {
  requestId?: unknown;
}

export const isCanonicalRequestId = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= REQUEST_ID_MAX_LENGTH &&
  CANONICAL_REQUEST_ID_PATTERN.test(value);

export const createCanonicalRequestId = (): string => randomUUID();

/**
 * Reads the request ID that the http-log middleware issued for this request.
 * Audit capture never writes ctx.state or X-Request-ID: when the value is
 * missing or invalid the caller generates a row-only UUID instead.
 */
export const readCanonicalRequestId = (
  state: CanonicalRequestState | undefined,
): string | null =>
  isCanonicalRequestId(state?.requestId) ? state.requestId : null;
