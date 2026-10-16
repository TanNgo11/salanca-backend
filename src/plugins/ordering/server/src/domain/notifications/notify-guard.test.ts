import { describe, expect, it } from 'vitest';

import { createGuard, parseAllowlist } from './notify-guard';

describe('parseAllowlist', () => {
  it('classifies email, domain and phone entries', () => {
    const parsed = parseAllowlist(['A@Example.invalid', '@example.invalid', '0901234567']);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect([...parsed.matcher.emails]).toEqual(['a@example.invalid']);
    expect([...parsed.matcher.domains]).toEqual(['example.invalid']);
    expect([...parsed.matcher.phones]).toEqual(['+84901234567']);
  });

  it('reports the position of each invalid entry', () => {
    const parsed = parseAllowlist(['fine@example.invalid', '', 'not a phone', '@']);
    expect(parsed).toEqual({ ok: false, invalid: [1, 2, 3] });
  });
});

describe('createGuard', () => {
  it('allows every recipient in live mode', () => {
    const guard = createGuard({ mode: 'live', allowlist: [] });
    expect(guard.allows('email', 'anyone@example.invalid')).toBe(true);
    expect(guard.allows('sms', '+84901234567')).toBe(true);
  });

  it('blocks everyone when the allowlist is empty (fail closed)', () => {
    const guard = createGuard({ mode: 'allowlist', allowlist: [] });
    expect(guard.allows('email', 'a@example.invalid')).toBe(false);
    expect(guard.allows('sms', '+84901234567')).toBe(false);
  });

  it('matches email entries case-insensitively', () => {
    const guard = createGuard({ mode: 'allowlist', allowlist: ['allowed@example.invalid'] });
    expect(guard.allows('email', 'Allowed@Example.INVALID')).toBe(true);
    expect(guard.allows('email', 'other@example.invalid')).toBe(false);
  });

  it('matches a domain entry on the exact domain boundary only', () => {
    const guard = createGuard({ mode: 'allowlist', allowlist: ['@example.invalid'] });
    expect(guard.allows('email', 'a@example.invalid')).toBe(true);
    expect(guard.allows('email', 'a@sub.example.invalid')).toBe(false);
    expect(guard.allows('email', 'a@xexample.invalid')).toBe(false);
  });

  it('matches a national phone entry against its E.164 value', () => {
    const guard = createGuard({ mode: 'allowlist', allowlist: ['0901234567'] });
    expect(guard.allows('sms', '+84901234567')).toBe(true);
    expect(guard.allows('zalo', '84901234567')).toBe(true);
    expect(guard.allows('sms', '+84900000000')).toBe(false);
  });

  it('never matches an email value on the sms channel', () => {
    const guard = createGuard({ mode: 'allowlist', allowlist: ['allowed@example.invalid'] });
    expect(guard.allows('sms', 'allowed@example.invalid')).toBe(false);
  });
});
