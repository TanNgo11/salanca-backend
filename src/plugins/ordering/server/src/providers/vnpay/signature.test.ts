import { createHmac } from 'node:crypto';
import { stringify } from 'node:querystring';

import { describe, expect, it } from 'vitest';

import { sortedParamString } from '../../domain/signatures';
import { VNPAY_HASH_EXCLUDES, vnpayChecksum, verifyVnpayParams } from './signature';

/**
 * The official VNPay Node.js sample (vnpay_nodejs, `sortObject` + `querystring.stringify(...,
 * { encode: false })`), re-implemented verbatim as an independent reference: values are
 * `encodeURIComponent`-ed with `%20` → `+` BEFORE signing.
 */
const officialSample = (params: Record<string, string>, secret: string) => {
  const sorted: Record<string, string> = {};
  for (const key of Object.keys(params).map(encodeURIComponent).sort()) {
    sorted[key] = encodeURIComponent(params[key]).replace(/%20/g, '+');
  }
  const signData = stringify(sorted, '&', '=', { encodeURIComponent: (value: string) => value });
  return { signData, hash: createHmac('sha512', secret).update(Buffer.from(signData, 'utf-8')).digest('hex') };
};

const SECRET = 'TESTSECRETKEY0123456789ABCDEFGHI';
const params = {
  vnp_Version: '2.1.0',
  vnp_Command: 'pay',
  vnp_TmnCode: 'TESTTMN1',
  vnp_Amount: '19800000',
  vnp_CurrCode: 'VND',
  vnp_TxnRef: 'SLC-000001-12',
  vnp_OrderInfo: 'Thanh toan don SLC-000001',
  vnp_OrderType: 'other',
  vnp_Locale: 'vn',
  vnp_ReturnUrl: 'https://shop.example/thanh-toan?x=1&y=a b',
  vnp_IpAddr: '127.0.0.1',
  vnp_CreateDate: '20261014090000',
};

describe('VNPay checksum (encoded sign data)', () => {
  it('signs the encoded form: spaces as +, URL characters percent-encoded', () => {
    const data = sortedParamString(params, VNPAY_HASH_EXCLUDES);
    expect(data).toContain('vnp_OrderInfo=Thanh+toan+don+SLC-000001');
    expect(data).toContain('vnp_ReturnUrl=https%3A%2F%2Fshop.example%2Fthanh-toan%3Fx%3D1%26y%3Da+b');
    expect(data.startsWith('vnp_Amount=19800000&vnp_Command=pay&vnp_CreateDate=20261014090000')).toBe(true);
  });

  it('matches the official Node sample byte for byte', () => {
    const reference = officialSample(params, SECRET);
    expect(sortedParamString(params, VNPAY_HASH_EXCLUDES)).toBe(reference.signData);
    expect(vnpayChecksum(SECRET, params)).toBe(reference.hash);
  });

  it('verifies an IPN whose decoded params carry spaces and a URL, and rejects a tampered one', () => {
    const vnp_SecureHash = officialSample(params, SECRET).hash;
    expect(verifyVnpayParams({ params: { ...params, vnp_SecureHash, vnp_SecureHashType: 'HmacSHA512' }, secret: SECRET }).ok).toBe(true);
    expect(verifyVnpayParams({ params: { ...params, vnp_Amount: '19900000', vnp_SecureHash }, secret: SECRET }).ok).toBe(false);
  });
});
