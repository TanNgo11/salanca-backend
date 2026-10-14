import type { JsonObject } from '../../contracts/common';
import { equalHex, hmacSha256Hex, signableFieldString } from '../../domain/signatures';

/**
 * MoMo AIO v2 signs HMAC-SHA256 over `key=value&…` in a FIXED field order per endpoint
 * (docs/providers/momo.md). Missing optional fields still emit `key=` in the sign string.
 */
export const MOMO_CREATE_SIGN_FIELDS = [
  'accessKey',
  'amount',
  'extraData',
  'ipnUrl',
  'orderId',
  'orderInfo',
  'partnerCode',
  'redirectUrl',
  'requestId',
  'requestType',
] as const;

export const MOMO_IPN_SIGN_FIELDS = [
  'accessKey',
  'amount',
  'extraData',
  'message',
  'orderId',
  'orderInfo',
  'orderType',
  'partnerCode',
  'payType',
  'requestId',
  'responseTime',
  'resultCode',
  'transId',
] as const;

export const MOMO_QUERY_SIGN_FIELDS = ['accessKey', 'orderId', 'partnerCode', 'requestId'] as const;

export const MOMO_REFUND_SIGN_FIELDS = [
  'accessKey',
  'amount',
  'description',
  'orderId',
  'partnerCode',
  'requestId',
  'transId',
] as const;

export const momoSign = (
  secretKey: string,
  fields: Record<string, string | number | undefined>,
  order: readonly string[],
): string => hmacSha256Hex(secretKey, signableFieldString(fields, order));

const text = (value: unknown): string =>
  typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';

export type MomoIpnVerdict =
  | { ok: true; payload: Record<string, string> }
  | { ok: false; reason: 'missing-signature' | 'partner-mismatch' | 'mismatch' };

/**
 * Verifies an IPN body (already parsed — MoMo signs field VALUES, not the raw bytes, so a
 * reserialized body is fine here; the raw body is still required upstream for logging).
 * `accessKey` must match ours too — a signature made with another merchant's key fails the
 * comparison anyway, but the explicit check catches misrouted payloads early.
 */
export const verifyMomoIpnSignature = (input: {
  payload: JsonObject;
  accessKey: string;
  partnerCode: string;
  secretKey: string;
}): MomoIpnVerdict => {
  const payload: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.payload)) {
    payload[key] = text(value);
  }
  const signature = payload.signature?.trim() ?? '';
  if (signature === '') return { ok: false, reason: 'missing-signature' };
  if (payload.accessKey !== input.accessKey || payload.partnerCode !== input.partnerCode) {
    return { ok: false, reason: 'partner-mismatch' };
  }
  const expected = momoSign(input.secretKey, payload, MOMO_IPN_SIGN_FIELDS);
  return equalHex(signature, expected)
    ? { ok: true, payload }
    : { ok: false, reason: 'mismatch' };
};
