import { describe, expect, it } from 'vitest';

import { isOrderingError } from '../errors';
import {
  DEFAULT_LOYALTY_SETTINGS,
  DEFAULT_TIERS,
  parseLoyaltySettingsInput,
  parseTierInput,
} from './settings';

const rejects = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    expect(isOrderingError(error) && error.code).toBe('VALIDATION_ERROR');
    return;
  }
  throw new Error('expected a validation error');
};

describe('loyalty settings', () => {
  it('defaults to the 2026-10-13 decisions with the program switched off', () => {
    expect(DEFAULT_LOYALTY_SETTINGS).toEqual({
      enabled: false,
      startsAt: null,
      earnPerAmount: 10_000,
      pointValue: 100,
      minRedeemPoints: 50,
      maxRedeemShare: 0.5,
      expiryMonths: 12,
      expiryReminderDays: 14,
      downgradeGraceDays: 30,
      dailyEarnCap: 2000,
      channels: ['pickup', 'delivery', 'dine-in'],
      countHistoryForTiers: true,
    });
  });

  it('fills defaults for a partial body and refuses unknown fields', () => {
    expect(parseLoyaltySettingsInput({ enabled: true, pointValue: 200 })).toMatchObject({
      enabled: true,
      pointValue: 200,
      earnPerAmount: 10_000,
    });
    rejects(() => parseLoyaltySettingsInput({ surprise: 1 }));
  });

  it('ignores the read-only startsAt so a GET body can be sent straight back to PUT', () => {
    const body = { ...DEFAULT_LOYALTY_SETTINGS, startsAt: '2026-10-10T00:00:00.000Z' };
    expect(parseLoyaltySettingsInput(body)).not.toHaveProperty('startsAt');
  });

  it('still rejects unknown keys alongside startsAt', () => {
    const { startsAt: _readOnly, ...writable } = DEFAULT_LOYALTY_SETTINGS;
    rejects(() => parseLoyaltySettingsInput({ ...writable, nope: 1 }));
  });

  it('rejects out-of-range numbers and duplicate channels', () => {
    rejects(() => parseLoyaltySettingsInput({ maxRedeemShare: 1.5 }));
    rejects(() => parseLoyaltySettingsInput({ earnPerAmount: 0 }));
    rejects(() => parseLoyaltySettingsInput({ minRedeemPoints: 1.5 }));
    rejects(() => parseLoyaltySettingsInput({ channels: ['pickup', 'pickup'] }));
    rejects(() => parseLoyaltySettingsInput({ channels: ['digital'] }));
  });
});

describe('loyalty tier input', () => {
  it('accepts the default tiers', () => {
    for (const tier of DEFAULT_TIERS) expect(parseTierInput(tier)).toEqual(tier);
  });

  it('rejects a bad code, a negative threshold and unknown keys', () => {
    const ok = DEFAULT_TIERS[1];
    rejects(() => parseTierInput({ ...ok, code: 'Bạc' }));
    rejects(() => parseTierInput({ ...ok, minSpend12m: -1 }));
    rejects(() => parseTierInput({ ...ok, multiplier: 1.5 }));
    rejects(() => parseTierInput({ ...ok, rank: 2 }));
  });
});
