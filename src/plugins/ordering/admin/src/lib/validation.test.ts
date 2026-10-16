import { describe, expect, it } from 'vitest';

import { fieldErrorsOf, issueText } from './validation';

const dict: Record<string, string> = {
  'validation.invalid': 'Chưa hợp lệ',
  'validation.too_small': 'Tối thiểu {min}',
  'validation.multiplier.too_small': 'Hệ số từ {min} (100 = ×1.0)',
};
const t = (key: string, values?: Record<string, string | number>, fallback?: string) => {
  const raw = dict[key];
  return raw ? raw.replace('{min}', String(values?.min ?? '')) : (fallback ?? key);
};

describe('issueText', () => {
  it('prefers the path-specific text', () => {
    expect(issueText(t, { path: 'multiplier', code: 'too_small', min: 10, message: 'Too small: expected number to be >=10' })).toBe('Hệ số từ 10 (100 = ×1.0)');
  });
  it('falls back to the code-only text, then to the generic line, never to the English message', () => {
    expect(issueText(t, { path: 'other', code: 'too_small', min: 3 })).toBe('Tối thiểu 3');
    expect(issueText(t, { path: 'other', code: 'weird', message: 'English text' })).toBe('Chưa hợp lệ');
  });
});

describe('fieldErrorsOf', () => {
  it('maps issues by path with translated text', () => {
    expect(fieldErrorsOf([{ path: 'multiplier', code: 'too_small', min: 10 }], t)).toEqual({ multiplier: 'Hệ số từ 10 (100 = ×1.0)' });
  });
});
