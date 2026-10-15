import { describe, expect, it } from 'vitest';

import {
  giftCardFailureCount,
  isWrongPromotionCode,
  noteGiftCardFailure,
  notePromotionCodeFailure,
  promotionCodeFailureCount,
  resetStorefrontLimiters,
} from './storefront-guard';

describe('promotion code guessing guard', () => {
  it('counts only reasons that reveal whether a code exists', () => {
    for (const reason of ['invalid', 'not-started', 'ended', 'code-used', 'usage-limit']) {
      expect(isWrongPromotionCode(reason)).toBe(true);
    }
    for (const reason of ['not-best', 'min-subtotal', 'per-customer', 'receive-kind', 'first-order', 'time', 'group']) {
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

describe('gift-card code guessing guard (O9)', () => {
  it('keeps its own window per IP, independent of promotion failures', () => {
    resetStorefrontLimiters();
    const start = 2_000_000;
    expect(noteGiftCardFailure('9.9.9.9', 900_000, start)).toBe(1);
    expect(noteGiftCardFailure('9.9.9.9', 900_000, start + 1000)).toBe(2);
    expect(giftCardFailureCount('9.9.9.9', start + 2000)).toBe(2);
    // Separate counter: promotion misses do not count against the card budget.
    expect(promotionCodeFailureCount('9.9.9.9', start + 2000)).toBe(0);
    expect(notePromotionCodeFailure('9.9.9.9', 600_000, start + 2000)).toBe(1);
    expect(giftCardFailureCount('9.9.9.9', start + 3000)).toBe(2);
    // Window expiry resets.
    expect(giftCardFailureCount('9.9.9.9', start + 901_000)).toBe(0);
  });
});
