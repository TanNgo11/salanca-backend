import { describe, expect, it } from 'vitest';

import {
  equalHex,
  equalSecret,
  hmacSha256Hex,
  hmacSha512Hex,
  signableFieldString,
  sortedParamString,
} from './signatures';

describe('domain/signatures', () => {
  it('hmacSha256Hex matches the published MoMo sample vector', () => {
    // docs/providers/momo.md — official sample: secret K951B6PE1waDMi640xX08PD3vg6EkVlz.
    const data =
      'partnerCode=MOMO&accessKey=F8BBA842ECF85&requestId=MM1540456472575&amount=150000' +
      '&orderId=MM1540456472575&orderInfo=SDK team.&returnUrl=https://momo.vn' +
      '&notifyUrl=https://momo.vn&extraData=email=abc@gmail.com';
    expect(hmacSha256Hex('K951B6PE1waDMi640xX08PD3vg6EkVlz', data)).toBe(
      '996ed81d68a1b05c99516835e404b2d0146d9b12fbcecbf80c7e51df51cac85e',
    );
  });

  it('hmacSha512Hex produces a 128-char hex digest', () => {
    const digest = hmacSha512Hex('secret', 'a=1&b=2');
    expect(digest).toMatch(/^[0-9a-f]{128}$/);
    expect(digest).toBe(hmacSha512Hex('secret', 'a=1&b=2'));
  });

  it('signableFieldString keeps the documented order and emits empty segments', () => {
    expect(
      signableFieldString(
        { amount: 150000, orderId: 'X1', extraData: undefined, partnerCode: 'MOMO' },
        ['partnerCode', 'amount', 'extraData', 'orderId'],
      ),
    ).toBe('partnerCode=MOMO&amount=150000&extraData=&orderId=X1');
  });

  it('sortedParamString sorts keys, skips excluded and empty values (VNPay-encoded)', () => {
    const params = {
      vnp_TmnCode: 'TEST',
      vnp_Amount: '15000000',
      vnp_SecureHash: 'deadbeef',
      vnp_SecureHashType: 'SHA512',
      vnp_Empty: '',
      vnp_CurrCode: 'VND',
    };
    expect(sortedParamString(params, ['vnp_SecureHash', 'vnp_SecureHashType'])).toBe(
      'vnp_Amount=15000000&vnp_CurrCode=VND&vnp_TmnCode=TEST',
    );
  });

  it('equalHex is constant-time and rejects length/case/non-hex mismatches safely', () => {
    const hex = 'ab'.repeat(32);
    expect(equalHex(hex, hex.toUpperCase())).toBe(true);
    expect(equalHex(hex, `${hex.slice(0, -2)}00`)).toBe(false);
    expect(equalHex('zz', hex)).toBe(false);
    expect(equalHex('', hex)).toBe(false);
  });

  it('equalSecret compares opaque tokens constant-time', () => {
    expect(equalSecret('token-123', 'token-123')).toBe(true);
    expect(equalSecret('token-123 ', 'token-123')).toBe(true);
    expect(equalSecret('other', 'token-123')).toBe(false);
    expect(equalSecret(undefined, 'token-123')).toBe(false);
    expect(equalSecret('', 'token-123')).toBe(false);
  });
});
