import { describe, expect, it } from 'vitest';

import { ahamoveBaseUrl, parseAhamoveSettings } from './config';

const valid = () => ({
  enabled: true,
  apiKey: 'test-api-key',
  mobile: '0901234567',
  webhookToken: 'test-webhook-token-12345',
});

describe('parseAhamoveSettings', () => {
  it('fills defaults and resolves the staging base URL', () => {
    const settings = parseAhamoveSettings(valid());
    expect(settings?.environment).toBe('staging');
    expect(settings?.serviceId).toBe('SGN-BIKE');
    expect(settings?.feeSource).toBe('zone');
    expect(ahamoveBaseUrl(settings!)).toBe('https://partner-apistg.ahamove.com');
  });

  it('accepts a pre-issued token in place of mobile', () => {
    const settings = parseAhamoveSettings({
      enabled: true,
      apiKey: 'test-api-key',
      token: 'issued-token',
      webhookToken: 'test-webhook-token-12345',
    });
    expect(settings?.token).toBe('issued-token');
  });

  it('requires mobile when no token is configured', () => {
    expect(() =>
      parseAhamoveSettings({ enabled: true, apiKey: 'k', webhookToken: '1234567890123456' }),
    ).toThrow(/mobile/);
  });

  it('returns null when absent or disabled', () => {
    expect(parseAhamoveSettings(undefined)).toBeNull();
    expect(parseAhamoveSettings({ enabled: false })).toBeNull();
  });

  it('rejects enabled-but-incomplete settings loudly', () => {
    expect(() => parseAhamoveSettings({ ...valid(), webhookToken: 'short' })).toThrow(/webhookToken/);
    expect(() => parseAhamoveSettings({ ...valid(), feeSource: 'auto' })).toThrow(/feeSource/);
    expect(() => parseAhamoveSettings({ ...valid(), requests: [{}] })).toThrow(/requests/);
  });
});
