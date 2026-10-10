/**
 * Redacts sensitive keys from payloads before they reach timeline events or the outbox.
 * Deep-clones plain objects and arrays; keys matching the sensitive pattern are replaced by
 * `'[redacted]'` unless allowlisted (identifiers that are safe and needed for correlation).
 */
const SENSITIVE_KEY =
  /name|phone|email|address|token|secret|password|recipient|street|line1|note/i;

const ALLOWLIST = new Set([
  'locationRef',
  'providerCode',
  'orderCode',
  'workflowName',
  'jobName',
  'alertCode',
  'typeName',
  'eventName',
  'providerReference',
  'providerTransactionId',
  'code',
]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null &&
  typeof value === 'object' &&
  (value.constructor === Object || Object.getPrototypeOf(value) === null);

export function maskPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskPayload);
  if (isPlainObject(value)) {
    const masked: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      masked[key] =
        !ALLOWLIST.has(key) && SENSITIVE_KEY.test(key) ? '[redacted]' : maskPayload(item);
    }
    return masked;
  }
  return value;
}
