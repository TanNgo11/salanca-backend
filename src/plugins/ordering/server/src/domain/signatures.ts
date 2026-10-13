import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Shared signature helpers for the O13 providers (docs/providers/*.md). Each adapter keeps its
 * own field order — this file only owns the digest and the comparisons, so a wrong call site
 * cannot silently weaken a check (all comparisons are constant-time).
 */
export const hmacHex = (
  algorithm: 'sha256' | 'sha512',
  secret: string,
  data: string,
): string => createHmac(algorithm, secret).update(data, 'utf8').digest('hex');

export const hmacSha256Hex = (secret: string, data: string): string =>
  hmacHex('sha256', secret, data);

export const hmacSha512Hex = (secret: string, data: string): string =>
  hmacHex('sha512', secret, data);

const HEX = /^[0-9a-f]+$/i;

/** Constant-time equality for two hex digests; different lengths or non-hex input → false. */
export const equalHex = (presented: string, expected: string): boolean => {
  const a = presented.trim().toLowerCase();
  const b = expected.trim().toLowerCase();
  if (a.length !== b.length || !HEX.test(a) || !HEX.test(b)) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
};

/**
 * Constant-time equality for opaque shared secrets (e.g. Ahamove's `apikey` webhook header,
 * which is not a digest). Missing/empty values never match.
 */
export const equalSecret = (
  presented: string | null | undefined,
  expected: string,
): boolean => {
  const a = presented?.trim() ?? '';
  const b = expected.trim();
  if (a === '' || b === '') return false;
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
};

/**
 * Builds `k1=v1&k2=v2` in the EXACT order given — MoMo and VNPay sign field lists, not sorted
 * maps, so the order array is the contract. A key missing from `fields` still emits `key=`
 * (both providers sign optional fields as empty segments).
 */
export const signableFieldString = (
  fields: Record<string, string | number | undefined>,
  order: readonly string[],
): string =>
  order.map((key) => `${key}=${fields[key] ?? ''}`).join('&');

/**
 * VNPay-style sign data: params sorted by key, joined as `k=v&…`, excluding listed keys
 * (`vnp_SecureHash`, `vnp_SecureHashType`) and empty values. Values are the DECODED form,
 * matching the official sample (`qs.stringify(params, { encode: false })`).
 */
export const sortedParamString = (
  params: Record<string, string>,
  exclude: readonly string[] = [],
): string => {
  const excluded = new Set(exclude);
  return Object.keys(params)
    .filter((key) => !excluded.has(key) && params[key] !== '')
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join('&');
};
