import { describe, expect, it } from 'vitest';

import { accountScope, parseSepaySettings, selectSepayAccount } from './config';

const account = {
  accountNumber: '0123456789',
  bankCode: 'MBBank',
  bankName: 'MB Bank',
  accountName: 'CONG TY SALANCA',
  locationRefs: ['Q1'] as const,
};

const valid = () => ({
  enabled: true,
  webhookSecret: 'test-webhook-secret-value',
  apiToken: 'test-api-token-value-xx',
  memoTemplate: 'SLC{orderCode}',
  accounts: {
    q1: account,
    shared: { ...account, accountNumber: '999000111222', locationRefs: 'all' as const },
  },
});

describe('parseSepaySettings', () => {
  it('accepts a keyed account map and fills defaults', () => {
    const settings = parseSepaySettings(valid());
    expect(settings?.captureMode).toBe('auto');
    expect(settings?.amountTolerance).toBe(0);
    expect(settings?.qrBaseUrl).toBe('https://qr.sepay.vn/img');
    expect(settings?.accounts.q1.accountNumber).toBe('0123456789');
  });

  it('returns null when the provider is off', () => {
    expect(parseSepaySettings(undefined)).toBeNull();
    expect(parseSepaySettings({ enabled: false })).toBeNull();
  });

  it('rejects a bad shape when the provider is on', () => {
    expect(() => parseSepaySettings({ enabled: true })).toThrow(/webhookSecret/);
    expect(() => parseSepaySettings({ ...valid(), webhookSecret: 'short' })).toThrow(/webhookSecret/);
    expect(() => parseSepaySettings({ ...valid(), accounts: [] })).toThrow(/accounts/);
    expect(() => parseSepaySettings({ ...valid(), accounts: {} })).toThrow(/at least one account/);
    expect(() => parseSepaySettings({ ...valid(), memoTemplate: 'pay here' })).toThrow(/orderCode/);
    expect(() => parseSepaySettings({ ...valid(), captureMode: 'manual' })).toThrow(/captureMode/);
    expect(() => parseSepaySettings({ ...valid(), amountTolerance: -1 })).toThrow(/amountTolerance/);
    expect(() =>
      parseSepaySettings({
        ...valid(),
        accounts: { q1: { ...account, accountNumber: '12-34' } },
      }),
    ).toThrow(/accountNumber/);
    expect(() => parseSepaySettings([])).toThrow(/expected an object/);
  });

  it('prefers a branch account over the shared one and matches incoming numbers', () => {
    const settings = parseSepaySettings(valid());
    expect(settings).not.toBeNull();
    expect(selectSepayAccount(settings!, 'Q1')?.key).toBe('q1');
    expect(selectSepayAccount(settings!, 'Q3')?.key).toBe('shared');
    expect(selectSepayAccount(settings!, 'Q9')?.accountNumber).toBe('999000111222');
    expect(accountScope(settings!, '0123456789')?.key).toBe('q1');
    expect(accountScope(settings!, '0000000000')).toBeNull();
  });
});
