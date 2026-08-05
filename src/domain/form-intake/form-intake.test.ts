import { describe, expect, it } from 'vitest';

import { isValidEmailAddress } from '../../shared/email/email';
import { parseBoundedInt } from './bounded-int';
import { optionalBoundedString, requiredBoundedString } from './bounded-string';
import { resolveClientIp } from './client-ip';
import { createFormFail } from './form-validation-error';
import { assertHoneypotClear } from './honeypot';
import { parseFormSourceLocale } from './source-locale';

const fail = createFormFail();

describe('form-intake bounded strings', () => {
  it('parses required and optional strings', () => {
    expect(requiredBoundedString(fail, '  hi ', 10, 'req', 'long', 'x')).toBe('hi');
    expect(optionalBoundedString(fail, '  a ', 10, 'long', 'x', 'body')).toBe('a');
    expect(optionalBoundedString(fail, '', 10, 'long', 'x', 'body')).toBeUndefined();
  });

  it('rejects overlong required', () => {
    try {
      requiredBoundedString(fail, 'abcd', 2, 'req', 'long', 'x');
      expect.unreachable();
    } catch (error) {
      expect((error as { code: string }).code).toBe('long');
    }
  });
});

describe('parseBoundedInt', () => {
  const opts = {
    min: 1,
    max: 10,
    requiredCode: 'req',
    invalidCode: 'bad',
    fieldLabel: 'n',
  };

  it('accepts int and digit string', () => {
    expect(parseBoundedInt(fail, 4, opts)).toBe(4);
    expect(parseBoundedInt(fail, '8', opts)).toBe(8);
  });

  it('rejects non-canonical strings and range', () => {
    expect(() => parseBoundedInt(fail, '08', opts)).toThrow(/integer/);
    expect(() => parseBoundedInt(fail, 0, opts)).toThrow(/between/);
  });
});

describe('isValidEmailAddress', () => {
  it('checks basic shape', () => {
    expect(isValidEmailAddress('a@b.co')).toBe(true);
    expect(isValidEmailAddress('nope')).toBe(false);
  });
});

describe('assertHoneypotClear', () => {
  it('allows empty honeypot', () => {
    expect(() => assertHoneypotClear(fail, '', 'hp', 'no')).not.toThrow();
    expect(() => assertHoneypotClear(fail, undefined, 'hp', 'no')).not.toThrow();
  });

  it('rejects filled honeypot', () => {
    expect(() => assertHoneypotClear(fail, 'x', 'hp', 'no')).toThrow(/no/);
  });
});

describe('parseFormSourceLocale', () => {
  it('reads sourceLocale and locale alias', () => {
    expect(parseFormSourceLocale(fail, { sourceLocale: 'vi' }, 'loc')).toBe('vi');
    expect(parseFormSourceLocale(fail, { locale: 'en' }, 'loc')).toBe('en');
  });
});

describe('resolveClientIp', () => {
  it('prefers request.ip', () => {
    expect(resolveClientIp({ request: { ip: '10.0.0.1' }, ip: '9.9.9.9' })).toBe('10.0.0.1');
    expect(resolveClientIp({})).toBe('unknown');
  });
});
