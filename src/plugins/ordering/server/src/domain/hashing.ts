import { createHash } from 'node:crypto';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  (value.constructor === Object || Object.getPrototypeOf(value) === null);

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
};

/** Deterministic JSON: sorted object keys recursively, arrays kept in order, `undefined` dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/** Stable payload hash for idempotency keys — same logical payload, same hash. */
export function hashPayload(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}
