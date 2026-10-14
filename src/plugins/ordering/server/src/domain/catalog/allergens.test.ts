import { describe, expect, it } from 'vitest';

import {
  ALLERGEN_CODES,
  DIETARY_TAGS,
  allergenLabel,
  dietaryLabel,
  normalizeAllergens,
  normalizeDietaryTags,
  normalizeKitchenStation,
  sanitizeAllergens,
  sanitizeDietaryTags,
} from './allergens';

describe('normalizeAllergens', () => {
  it.each([
    ['empty', [], true],
    ['known codes', ['gluten', 'milk'], true],
    ['all 14 EU codes', [...ALLERGEN_CODES], true],
    ['custom entry', ['custom:Hạt điều'], true],
    ['case-insensitive', ['GLUTEN', 'Milk'], true],
    ['unknown code', ['shellfish'], false],
    ['non-array', 'gluten', false],
    ['non-string entry', ['gluten', 7], false],
    ['empty custom name', ['custom:'], false],
    ['over-long custom name', [`custom:${'x'.repeat(61)}`], false],
    ['custom name with comma', ['custom:a,b'], false],
  ])('%s → %s', (_label, raw, expected) => {
    expect(normalizeAllergens(raw).valid).toBe(expected);
  });

  it('dedupes and normalizes case', () => {
    const result = normalizeAllergens(['Gluten', 'gluten', ' MILK ']);
    expect(result.valid).toBe(true);
    expect(result.valid && result.value).toEqual(['gluten', 'milk']);
  });

  it('accepts null/undefined as empty', () => {
    for (const raw of [null, undefined]) {
      const result = normalizeAllergens(raw);
      expect(result.valid).toBe(true);
      expect(result.valid && result.value).toEqual([]);
    }
  });
});

describe('normalizeDietaryTags', () => {
  it.each([
    ['known tags', ['vegan', 'spicy'], true],
    ['all tags', [...DIETARY_TAGS], true],
    ['unknown tag', ['keto'], false],
    ['non-array', 'vegan', false],
  ])('%s → %s', (_label, raw, expected) => {
    expect(normalizeDietaryTags(raw).valid).toBe(expected);
  });
});

describe('sanitize*', () => {
  it('drops unknown entries but keeps valid ones', () => {
    expect(sanitizeAllergens(['gluten', 'bogus', 'custom:Tôm khô'])).toEqual([
      'gluten',
      'custom:Tôm khô',
    ]);
    expect(sanitizeDietaryTags(['vegan', 'keto'])).toEqual(['vegan']);
  });

  it('non-array input → empty', () => {
    expect(sanitizeAllergens('gluten')).toEqual([]);
    expect(sanitizeDietaryTags({ vegan: true })).toEqual([]);
  });
});

describe('labels', () => {
  it('resolves per locale with vi fallback', () => {
    expect(allergenLabel('crustacean', 'vi')).toBe('Giáp xác');
    expect(allergenLabel('crustacean', 'en')).toBe('Crustaceans');
    expect(allergenLabel('crustacean', 'fr')).toBe('Giáp xác');
    expect(dietaryLabel('vegan', 'vi')).toBe('Thuần chay');
    expect(dietaryLabel('vegan', 'en')).toBe('Vegan');
  });

  it('custom allergen label is the stored name', () => {
    expect(allergenLabel('custom:Hạt điều', 'vi')).toBe('Hạt điều');
  });
});

describe('normalizeKitchenStation', () => {
  it.each([
    ['plain', 'Bếp nóng', 'Bếp nóng'],
    ['trims', '  bar  ', 'bar'],
    ['empty → null', '   ', null],
    ['non-string → null', 42, null],
    ['null → null', null, null],
    ['over-long → null', 'x'.repeat(65), null],
  ])('%s', (_label, raw, expected) => {
    expect(normalizeKitchenStation(raw)).toBe(expected);
  });
});
