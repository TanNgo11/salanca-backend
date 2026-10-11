import { describe, expect, it } from 'vitest';

import { maskPhone, normalizeVietnamesePhone } from './phone';

describe('normalizeVietnamesePhone', () => {
  it('normalizes national and international mobile numbers to E.164', () => {
    for (const input of ['0901234567', '090 123 4567', '090.123.4567', '+84901234567', '84901234567', '+84 90-123-4567']) {
      expect(normalizeVietnamesePhone(input)).toEqual({
        valid: true,
        national: '0901234567',
        e164: '+84901234567',
      });
    }
  });

  it('accepts fixed lines with the 02x prefix', () => {
    expect(normalizeVietnamesePhone('028 3822 1234')).toEqual({
      valid: true,
      national: '02838221234',
      e164: '+842838221234',
    });
  });

  it('rejects empty, short, foreign-looking and non-numeric input', () => {
    expect(normalizeVietnamesePhone('')).toEqual({ valid: false, reason: 'empty' });
    expect(normalizeVietnamesePhone(undefined)).toEqual({ valid: false, reason: 'empty' });
    for (const input of ['090123456', '09012345678', '0101234567', '+1 415 555 0100', '09o1234567']) {
      expect(normalizeVietnamesePhone(input)).toEqual({ valid: false, reason: 'format' });
    }
  });

  it('masks the middle digits', () => {
    expect(maskPhone('0901234567')).toBe('090•••4567');
    expect(maskPhone('123')).toBe('•••');
  });
});
