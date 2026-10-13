import { describe, expect, it } from 'vitest';

import { parseVnpaySettings, vnpayBaseUrl } from './config';

const valid = () => ({
  enabled: true,
  tmnCode: 'TESTCODE',
  hashSecret: 'test-hash-secret',
});

describe('parseVnpaySettings', () => {
  it('fills defaults and resolves the sandbox base URL', () => {
    const settings = parseVnpaySettings(valid());
    expect(settings?.environment).toBe('sandbox');
    expect(settings?.locale).toBe('vn');
    expect(settings?.orderType).toBe('other');
    expect(vnpayBaseUrl(settings!)).toBe('https://sandbox.vnpayment.vn');
  });

  it('returns null when absent or disabled', () => {
    expect(parseVnpaySettings(undefined)).toBeNull();
    expect(parseVnpaySettings({ enabled: false })).toBeNull();
  });

  it('rejects enabled-but-incomplete settings loudly', () => {
    expect(() => parseVnpaySettings({ enabled: true })).toThrow(/vnpay/);
    expect(() => parseVnpaySettings({ ...valid(), hashSecret: 'x' })).toThrow(/hashSecret/);
    expect(() => parseVnpaySettings({ ...valid(), environment: 'qa' })).toThrow(/environment/);
  });
});
