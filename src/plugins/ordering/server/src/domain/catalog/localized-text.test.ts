import { describe, expect, it } from 'vitest';

import {
  LOCALIZED_TEXT_MAX_NAME,
  resolveLocalizedText,
  validateLocalizedText,
} from './localized-text';

const LOCALES = ['vi', 'en'];

const validate = (raw: unknown, options = {}) =>
  validateLocalizedText(raw, { enabledLocales: LOCALES, ...options });

describe('validateLocalizedText', () => {
  it.each([
    ['full map', { vi: 'Bún bò', en: 'Beef noodles' }, true],
    ['single locale', { vi: 'Bún bò' }, true],
    ['empty object optional', {}, true],
    ['null optional', null, true],
    ['undefined optional', undefined, true],
    ['array', ['Bún bò'], false],
    ['string', 'Bún bò', false],
    ['number', 12, false],
    ['unsupported locale', { vi: 'a', fr: 'b' }, false],
    ['non-string value', { vi: 42 }, false],
    ['boolean value', { vi: true }, false],
  ])('%s → %s', (_label, raw, expected) => {
    expect(validate(raw).valid).toBe(expected);
  });

  it('rejects a string longer than the field max', () => {
    const long = 'x'.repeat(LOCALIZED_TEXT_MAX_NAME + 1);
    const result = validate({ vi: long });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.details.locale).toBe('vi');
  });

  it('accepts a string exactly at the max', () => {
    expect(validate({ vi: 'x'.repeat(LOCALIZED_TEXT_MAX_NAME) }).valid).toBe(true);
  });

  it('required rejects null, empty object and all-blank values', () => {
    for (const raw of [null, undefined, {}, { vi: '   ', en: '' }]) {
      expect(validate(raw, { required: true, field: 'name' }).valid).toBe(false);
    }
  });

  it('required accepts one non-empty locale', () => {
    expect(validate({ vi: '', en: 'Name' }, { required: true }).valid).toBe(true);
  });

  it('reports the failing field and locale in details', () => {
    const result = validate({ vi: 'a', fr: 'b' }, { field: 'slug' });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.details).toEqual({ field: 'slug', locale: 'fr' });
      expect(result.message).toContain('slug');
      expect(result.message).toContain('fr');
    }
  });
});

describe('resolveLocalizedText', () => {
  const value = { vi: 'Bún bò', en: 'Beef noodles' };

  it.each([
    ['exact locale', { vi: 'Bún bò', en: 'Beef noodles' }, 'en', 'Beef noodles'],
    ['falls back to default', { vi: 'Bún bò' }, 'en', 'Bún bò'],
    ['falls back past blank locale', { vi: '', en: 'Beef noodles' }, 'vi', 'Beef noodles'],
    ['first non-empty when default missing too', { en: 'Beef noodles' }, 'fr', 'Beef noodles'],
    ['undefined when empty', {}, 'vi', undefined],
    ['undefined for non-object', 'x', 'vi', undefined],
    ['undefined for null', null, 'vi', undefined],
  ])('%s', (_label, raw, locale, expected) => {
    expect(resolveLocalizedText(raw, locale, 'vi')).toBe(expected);
  });

  it('prefers the requested locale over the default', () => {
    expect(resolveLocalizedText(value, 'en', 'vi')).toBe('Beef noodles');
  });
});
