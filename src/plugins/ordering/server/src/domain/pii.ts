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

/** `n•••@gmail.com` — the only email rendering Admin screens ever get (O9 screens G2). */
export const maskEmail = (email: string | null | undefined): string | null => {
  const trimmed = (email ?? '').trim();
  const at = trimmed.indexOf('@');
  if (at <= 0) return null;
  return `${trimmed[0]}•••@${trimmed.slice(at + 1)}`;
};

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

/**
 * Keys retained on a payment-event raw payload after the retention job redacts it
 * (O6 §19.9). Everything needed to reconcile — ids, amounts, the bank reference —
 * stays; free-text fields that carry names/account numbers (content, description,
 * accountNumber, sender*, headers, body, …) are dropped.
 */
export const RETAINED_PAYLOAD_KEYS = [
  'id',
  'transferAmount',
  'transferType',
  'transactionDate',
  'referenceCode',
  'gateway',
  'code',
  'source',
  'accountKey',
  'memoCode',
  'manual',
  'confirmed',
  'confirmedAt',
  'transferredAt',
  'sepayTransactionId',
  'kind',
  'amount',
  'currency',
  'providerTransactionId',
] as const;

const KEEP = new Set<string>(RETAINED_PAYLOAD_KEYS);

/**
 * Returns the payload with only the retained keys plus `redactedAt`. Non-object or
 * unparsable input collapses to `{ redactedAt, unparsable: true }`.
 */
export const redactPayload = (
  raw: unknown,
  redactedAt: string,
): Record<string, unknown> => {
  let source = raw;
  if (typeof source === 'string') {
    try {
      source = JSON.parse(source);
    } catch {
      return { redactedAt, unparsable: true };
    }
  }
  if (!isPlainObject(source)) {
    return { redactedAt, unparsable: true };
  }
  const kept: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (KEEP.has(key)) kept[key] = value;
  }
  return { ...kept, redactedAt };
};
