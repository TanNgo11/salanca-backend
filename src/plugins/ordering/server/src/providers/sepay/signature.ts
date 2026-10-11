import { createHmac, timingSafeEqual } from 'node:crypto';

/** SePay signs `{X-SePay-Timestamp}.{raw_body}` with HMAC-SHA256 and sends `sha256=<hex>`. */
export const signSepayBody = (secret: string, timestamp: string, rawBody: string): string =>
  createHmac('sha256', secret).update(`${timestamp}.${rawBody}`).digest('hex');

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; reason: 'missing-header' | 'stale' | 'mismatch' };

const HEX = /^[0-9a-f]+$/i;

/**
 * Rejects a missing header, a timestamp more than `toleranceSeconds` from `now` (default 300,
 * anti-replay), or a signature that differs by even one byte. Comparison is constant-time.
 */
export const verifySepaySignature = (input: {
  secret: string;
  timestampHeader: string | undefined;
  signatureHeader: string | undefined;
  rawBody: string;
  now: Date;
  toleranceSeconds?: number;
}): SignatureVerdict => {
  const timestamp = input.timestampHeader?.trim();
  const signature = input.signatureHeader?.trim();
  if (!timestamp || !signature) return { ok: false, reason: 'missing-header' };
  if (!/^\d{1,12}$/.test(timestamp)) return { ok: false, reason: 'stale' };
  const skewSeconds = Math.abs(input.now.getTime() / 1000 - Number(timestamp));
  if (skewSeconds > (input.toleranceSeconds ?? 300)) return { ok: false, reason: 'stale' };
  const presented = signature.replace(/^sha256=/i, '').toLowerCase();
  const expected = signSepayBody(input.secret, timestamp, input.rawBody);
  if (presented.length !== expected.length || !HEX.test(presented)) {
    return { ok: false, reason: 'mismatch' };
  }
  const same = timingSafeEqual(Buffer.from(presented, 'hex'), Buffer.from(expected, 'hex'));
  return same ? { ok: true } : { ok: false, reason: 'mismatch' };
};
