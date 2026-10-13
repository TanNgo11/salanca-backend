import { describe, expect, it } from 'vitest';

import {
  isWrongPromotionCode,
  notePromotionCodeFailure,
  promotionCodeFailureCount,
  resetStorefrontLimiters,
} from './storefront-guard';

describe('promotion code guessing guard', () => {
  it('counts only reasons that reveal whether a code exists', () => {
    for (const reason of ['invalid', 'not-started', 'ended', 'code-used', 'usage-limit']) {
      expect(isWrongPromotionCode(reason)).toBe(true);
    }
    for (const reason of ['not-best', 'min-subtotal', 'per-customer', 'receive-kind', 'first-order', 'time']) {
      expect(isWrongPromotionCode(reason)).toBe(false);
    }
  });

  it('keeps a 10-minute window per IP', () => {
    resetStorefrontLimiters();
    const start = 1_000_000;
    expect(notePromotionCodeFailure('1.2.3.4', 600_000, start)).toBe(1);
    expect(notePromotionCodeFailure('1.2.3.4', 600_000, start + 1000)).toBe(2);
    expect(promotionCodeFailureCount('5.6.7.8', start)).toBe(0);
    expect(promotionCodeFailureCount('1.2.3.4', start + 10 * 60 * 1000)).toBe(0);
  });
});
