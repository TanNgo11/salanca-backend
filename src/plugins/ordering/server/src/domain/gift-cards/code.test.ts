import { describe, expect, it } from 'vitest';

import {
  formatGiftCardCode,
  generateGiftCardCode,
  GIFT_CARD_ALPHABET,
  GIFT_CARD_CODE_LENGTH,
  giftCardCodeHash,
  last4Of,
  normalizeGiftCardCode,
} from './code';

describe('gift-card code', () => {
  it('generates 100,000 unique codes from the unambiguous alphabet', () => {
    const pattern = new RegExp(`^[${GIFT_CARD_ALPHABET}]{${GIFT_CARD_CODE_LENGTH}}$`);
    const codes = Array.from({ length: 100_000 }, () => generateGiftCardCode());
    expect(codes.every((code) => pattern.test(code))).toBe(true);
    expect(new Set(codes).size).toBe(100_000);
  });

  it('normalizes by dropping dashes/whitespace and uppercasing', () => {
    const raw = generateGiftCardCode();
    const withDashes = formatGiftCardCode(raw).toLowerCase();
    expect(normalizeGiftCardCode(withDashes)).toBe(raw);
    expect(normalizeGiftCardCode(` ${formatGiftCardCode(raw)} `)).toBe(raw);
  });

  it('rejects forbidden characters, wrong lengths and non-strings', () => {
    // O, I, L, 0, 1 are outside the alphabet; a 16-char string containing them fails.
    expect(normalizeGiftCardCode('OOOOOOOOOOOOOOOO')).toBeNull();
    expect(normalizeGiftCardCode('IIIIIIIIIIIIIIII')).toBeNull();
    expect(normalizeGiftCardCode('LLLLLLLLLLLLLLLL')).toBeNull();
    expect(normalizeGiftCardCode('0000000000000000')).toBeNull();
    expect(normalizeGiftCardCode('1111111111111111')).toBeNull();
    expect(normalizeGiftCardCode('ABCDEFGHJKMNPQR')).toBeNull(); // 15
    expect(normalizeGiftCardCode('ABCDEFGHJKMNPQRST')).toBeNull(); // 17
    expect(normalizeGiftCardCode(123)).toBeNull();
    expect(normalizeGiftCardCode(null)).toBeNull();
  });

  it('formats as XXXX-XXXX-XXXX-XXXX and keeps the last four', () => {
    expect(formatGiftCardCode('ABCDEFGHJKMNPQRS')).toBe('ABCD-EFGH-JKMN-PQRS');
    expect(last4Of('ABCDEFGHJKMNPQRS')).toBe('PQRS');
  });

  it('hashes deterministically under the key and differs across codes', () => {
    const key = Buffer.alloc(32, 7);
    const a = generateGiftCardCode();
    const b = generateGiftCardCode();
    expect(giftCardCodeHash(key, a)).toMatch(/^[0-9a-f]{64}$/);
    expect(giftCardCodeHash(key, a)).toBe(giftCardCodeHash(key, a));
    expect(giftCardCodeHash(key, a)).not.toBe(giftCardCodeHash(key, b));
    // A different key produces a different hash for the same code.
    expect(giftCardCodeHash(Buffer.alloc(32, 8), a)).not.toBe(giftCardCodeHash(key, a));
  });
});
