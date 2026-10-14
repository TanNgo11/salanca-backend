import { describe, expect, it } from 'vitest';

import { parseZaloSettings } from './config';

describe('parseZaloSettings', () => {
  it('accepts a static access token', () => {
    const settings = parseZaloSettings({ enabled: true, accessToken: 'token' });
    expect(settings?.baseUrl).toBe('https://business.openapi.zalo.me');
  });

  it('accepts the OAuth refresh triple without an access token', () => {
    const settings = parseZaloSettings({
      enabled: true,
      appId: 'app',
      appSecret: 'secret',
      refreshToken: 'refresh',
    });
    expect(settings?.accessToken).toBeUndefined();
  });

  it('requires either the token or the full OAuth triple', () => {
    expect(() => parseZaloSettings({ enabled: true })).toThrow(/accessToken/);
    expect(() => parseZaloSettings({ enabled: true, appId: 'app' })).toThrow(/accessToken/);
  });

  it('returns null when absent or disabled', () => {
    expect(parseZaloSettings(undefined)).toBeNull();
    expect(parseZaloSettings({ enabled: false })).toBeNull();
  });
});
