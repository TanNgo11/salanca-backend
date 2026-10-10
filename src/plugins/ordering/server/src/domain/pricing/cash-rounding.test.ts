import { describe, expect, it } from 'vitest';

import { appliesCashRounding, cashRoundingDelta } from './cash-rounding';

describe('cashRoundingDelta', () => {
  it.each([
    [195500, 1000, 500],
    [195400, 1000, -400],
    [195000, 1000, 0],
    [-195500, 1000, -500],
    [-195400, 1000, 400],
    [1234, 100, -34],
    [1250, 100, 50],
    [999, 1000, 1],
  ])('amount %i multiple %i → delta %i', (amount, multiple, expected) => {
    expect(cashRoundingDelta(amount, multiple)).toBe(expected);
  });

  it('rejects a non-positive or non-integer multiple', () => {
    expect(() => cashRoundingDelta(100, 0)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() => cashRoundingDelta(100, -100)).toThrowError(
      expect.objectContaining({ code: 'VALIDATION_ERROR' }),
    );
    expect(() => cashRoundingDelta(100, 2.5)).toThrowError(
      expect.objectContaining({ code: 'MONEY_INVALID' }),
    );
  });
});

describe('appliesCashRounding', () => {
  const policy = { enabled: true, multiple: 1000, providerCodes: ['cash'] };

  it('applies only to enabled policies and listed providers', () => {
    expect(appliesCashRounding(policy, 'cash')).toBe(true);
    expect(appliesCashRounding(policy, 'bank-transfer')).toBe(false);
    expect(appliesCashRounding({ ...policy, enabled: false }, 'cash')).toBe(false);
    expect(appliesCashRounding(null, 'cash')).toBe(false);
    expect(appliesCashRounding(undefined, 'cash')).toBe(false);
    expect(appliesCashRounding(policy, undefined)).toBe(false);
  });
});
