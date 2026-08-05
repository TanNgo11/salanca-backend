import { describe, expect, it } from 'vitest';

import { isPlainRecord, trimmedNonEmptyString } from './value';

describe('isPlainRecord', () => {
  it('rejects non-object values', () => {
    expect(isPlainRecord(undefined)).toBe(false);
    expect(isPlainRecord(null)).toBe(false);
    expect(isPlainRecord('value')).toBe(false);
    expect(isPlainRecord(42)).toBe(false);
    expect(isPlainRecord(true)).toBe(false);
    expect(isPlainRecord(Symbol('s'))).toBe(false);
  });

  it('rejects functions and arrays', () => {
    expect(isPlainRecord(() => undefined)).toBe(false);
    expect(isPlainRecord([])).toBe(false);
    expect(isPlainRecord([1, 2, 3])).toBe(false);
  });

  it('accepts ordinary object literals', () => {
    expect(isPlainRecord({})).toBe(true);
    expect(isPlainRecord({ key: 'value' })).toBe(true);
  });

  it('accepts null-prototype records', () => {
    expect(isPlainRecord(Object.create(null))).toBe(true);
    expect(isPlainRecord(Object.assign(Object.create(null), { key: 1 }))).toBe(true);
  });

  it('accepts class instances to preserve the historical guard behavior', () => {
    class Example {
      value = 1;
    }

    expect(isPlainRecord(new Example())).toBe(true);
    expect(isPlainRecord(new Date())).toBe(true);
  });
});

describe('trimmedNonEmptyString', () => {
  it('returns the trimmed string for a valid padded string', () => {
    expect(trimmedNonEmptyString('  hello  ')).toBe('hello');
    expect(trimmedNonEmptyString('hello')).toBe('hello');
    expect(trimmedNonEmptyString('\t spaced \n')).toBe('spaced');
  });

  it('returns null for missing, empty, and whitespace-only strings', () => {
    expect(trimmedNonEmptyString(undefined)).toBeNull();
    expect(trimmedNonEmptyString(null)).toBeNull();
    expect(trimmedNonEmptyString('')).toBeNull();
    expect(trimmedNonEmptyString('   ')).toBeNull();
    expect(trimmedNonEmptyString('\t\n')).toBeNull();
  });

  it('returns null for wrong types without throwing', () => {
    expect(trimmedNonEmptyString(42)).toBeNull();
    expect(trimmedNonEmptyString(true)).toBeNull();
    expect(trimmedNonEmptyString([])).toBeNull();
    expect(trimmedNonEmptyString({})).toBeNull();
    expect(trimmedNonEmptyString(() => undefined)).toBeNull();
  });
});
