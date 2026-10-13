import { describe, expect, it } from 'vitest';

import { momoBaseUrl, parseMomoSettings } from './config';

const valid = () => ({
  enabled: true,
  partnerCode: 'MOMO_TEST',
  accessKey: 'test-access-key',
  secretKey: 'test-secret-key',
});

describe('parseMomoSettings', () => {
  it('fills defaults and resolves the sandbox base URL', () => {
    const settings = parseMomoSettings(valid());
    expect(settings?.environment).toBe('sandbox');
    expect(settings?.requestType).toBe('captureWallet');
    expect(momoBaseUrl(settings!)).toBe('https://test-payment.momo.vn');
  });

  it('prefers an explicit baseUrl override (fake servers in tests)', () => {
    const settings = parseMomoSettings({ ...valid(), baseUrl: 'http://127.0.0.1:9999' });
    expect(momoBaseUrl(settings!)).toBe('http://127.0.0.1:9999');
  });

  it('returns null when absent or disabled', () => {
    expect(parseMomoSettings(undefined)).toBeNull();
    expect(parseMomoSettings({ enabled: false })).toBeNull();
  });

  it('rejects enabled-but-incomplete settings loudly', () => {
    expect(() => parseMomoSettings({ enabled: true })).toThrow(/momo/);
    expect(() => parseMomoSettings({ ...valid(), secretKey: '' })).toThrow(/secretKey/);
    expect(() => parseMomoSettings({ ...valid(), environment: 'qa' })).toThrow(/environment/);
    expect(() => parseMomoSettings([])).toThrow(/expected an object/);
  });
});
