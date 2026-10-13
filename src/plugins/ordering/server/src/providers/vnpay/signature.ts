import { hmacSha512Hex, equalHex, sortedParamString } from '../../domain/signatures';

/**
 * VNPay checksums (docs/providers/vnpay.md). Pay URL + IPN verify sign the sorted `k=v&…`
 * string of every `vnp_*` param except the hash fields, over DECODED values (official
 * sample: `qs.stringify(params, { encode: false })`). querydr/refund sign a pipe-joined
 * field list instead.
 */
export const VNPAY_HASH_EXCLUDES = ['vnp_SecureHash', 'vnp_SecureHashType'] as const;

export const vnpayChecksum = (secret: string, params: Record<string, string>): string =>
  hmacSha512Hex(secret, sortedParamString(params, VNPAY_HASH_EXCLUDES));

/** querydr sign order (docs/providers/vnpay.md). */
export const VNPAY_QUERY_PIPE_FIELDS = [
  'vnp_RequestId',
  'vnp_Version',
  'vnp_Command',
  'vnp_TmnCode',
  'vnp_TxnRef',
  'vnp_TransactionDate',
  'vnp_CreateDate',
  'vnp_IpAddr',
  'vnp_OrderInfo',
] as const;

/** refund sign order — TransactionType/Amount/TransactionNo/CreateBy slot in per docs. */
export const VNPAY_REFUND_PIPE_FIELDS = [
  'vnp_RequestId',
  'vnp_Version',
  'vnp_Command',
  'vnp_TmnCode',
  'vnp_TransactionType',
  'vnp_TxnRef',
  'vnp_Amount',
  'vnp_TransactionNo',
  'vnp_TransactionDate',
  'vnp_CreateBy',
  'vnp_CreateDate',
  'vnp_IpAddr',
  'vnp_OrderInfo',
] as const;

export const vnpayPipeChecksum = (
  secret: string,
  fields: Record<string, string>,
  order: readonly string[],
): string => hmacSha512Hex(secret, order.map((key) => fields[key] ?? '').join('|'));

export type VnpayVerifyVerdict =
  | { ok: true; params: Record<string, string> }
  | { ok: false; reason: 'missing-signature' | 'mismatch' };

/**
 * Verifies a vnp_* param set (decoded — koa already parsed the query). `vnp_TmnCode` is
 * checked by the caller; the hash itself covers every other field so a foreign-merchant
 * payload still fails the digest.
 */
export const verifyVnpayParams = (input: {
  params: Record<string, unknown>;
  secret: string;
}): VnpayVerifyVerdict => {
  const params: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.params)) {
    if (!key.startsWith('vnp_')) continue;
    if (typeof value === 'string') params[key] = value;
    else if (typeof value === 'number') params[key] = String(value);
    // arrays/objects are malformed for VNPay — drop them from the signed set
  }
  const presented = params.vnp_SecureHash?.trim() ?? '';
  if (presented === '') return { ok: false, reason: 'missing-signature' };
  const expected = vnpayChecksum(input.secret, params);
  return equalHex(presented, expected) ? { ok: true, params } : { ok: false, reason: 'mismatch' };
};

const VNP_TZ_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Ho_Chi_Minh, no DST

/** `yyyyMMddHHmmss` in GMT+7 — the only timestamp format VNPay accepts. */
export const vnpayDate = (date: Date): string => {
  const shifted = new Date(date.getTime() + VNP_TZ_OFFSET_MS);
  return shifted.toISOString().slice(0, 19).replace(/[-:T]/g, '');
};

/** Inverse of `vnpayDate` for sanity checks. */
export const vnpayDateToDate = (value: string): Date | null => {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s) - VNP_TZ_OFFSET_MS);
  return Number.isNaN(date.getTime()) ? null : date;
};
