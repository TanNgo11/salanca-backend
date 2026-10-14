import { describe, expect, it } from 'vitest';

import { parseEsmsSettings } from './config';

const valid = () => ({
  enabled: true,
  apiKey: 'test-api-key',
  secretKey: 'test-secret-key',
  brandname: 'SALANCA',
});

describe('parseEsmsSettings', () => {
  it('fills defaults', () => {
    const settings = parseEsmsSettings(valid());
    expect(settings?.smsType).toBe('2');
    expect(settings?.isUnicode).toBe(true);
    expect(settings?.sandbox).toBe(false);
    expect(settings?.baseUrl).toBe('https://rest.esms.vn');
  });

  it('requires a brandname unless SmsType is 8', () => {
    expect(() =>
      parseEsmsSettings({ enabled: true, apiKey: 'k', secretKey: 's' }),
    ).toThrow(/brandname/);
    const settings = parseEsmsSettings({
      enabled: true,
      apiKey: 'k',
      secretKey: 's',
      smsType: '8',
    });
    expect(settings?.brandname).toBeUndefined();
  });

  it('returns null when absent or disabled', () => {
    expect(parseEsmsSettings(undefined)).toBeNull();
    expect(parseEsmsSettings({ enabled: false })).toBeNull();
  });
});
