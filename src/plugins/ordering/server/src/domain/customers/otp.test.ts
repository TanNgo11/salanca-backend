import { describe, expect, it } from 'vitest';

import { o11Hashing } from './identity';
import {
  generateBearerToken,
  generateChallengeId,
  generateOtpCode,
  isOtpCodeShape,
  normalizeEmailTarget,
  otpCodeMatches,
  verdictFor,
} from './otp';

// Keys must base64-decode to exactly 32 bytes (see token-cipher.parseEncryptionKey).
const hashing = o11Hashing(Buffer.from('a'.repeat(32)).toString('base64'));
const otherHashing = o11Hashing(Buffer.from('b'.repeat(32)).toString('base64'));

describe('generateOtpCode', () => {
  it('produces a 6-digit string within range', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateOtpCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(Number(code)).toBeLessThan(1_000_000);
    }
  });

  it('is not constant across calls', () => {
    const codes = new Set(Array.from({ length: 50 }, () => generateOtpCode()));
    expect(codes.size).toBeGreaterThan(40);
  });
});

describe('otpCodeMatches', () => {
  it('accepts the exact code', () => {
    const challengeId = generateChallengeId();
    const stored = hashing.otpCodeHash('123456', challengeId);
    expect(otpCodeMatches(hashing, '123456', challengeId, stored)).toBe(true);
  });

  it('rejects a wrong code, a wrong challengeId and a different key', () => {
    const challengeId = generateChallengeId();
    const stored = hashing.otpCodeHash('123456', challengeId);
    expect(otpCodeMatches(hashing, '654321', challengeId, stored)).toBe(false);
    expect(otpCodeMatches(hashing, '123456', generateChallengeId(), stored)).toBe(false);
    expect(otpCodeMatches(otherHashing, '123456', challengeId, stored)).toBe(false);
    expect(otpCodeMatches(hashing, '123456', challengeId, 'deadbeef')).toBe(false);
  });
});

describe('verdictFor', () => {
  const base = { attempts: 0, expiresAt: new Date('2026-10-13T10:05:00Z'), consumedAt: null };
  const now = new Date('2026-10-13T10:00:00Z');
  const options = { now, maxAttempts: 5 };

  it('accepts a matching, live, unconsumed challenge', () => {
    expect(verdictFor(base, true, options)).toEqual({ ok: true });
  });

  it('rejects expired challenges even with the right code', () => {
    const verdict = verdictFor({ ...base, expiresAt: now }, true, options);
    expect(verdict).toEqual({ ok: false, reason: 'expired', attemptsLeft: 0 });
  });

  it('rejects consumed challenges', () => {
    const verdict = verdictFor({ ...base, consumedAt: now }, true, options);
    expect(verdict).toEqual({ ok: false, reason: 'consumed', attemptsLeft: 0 });
  });

  it('locks after maxAttempts even with the right code', () => {
    const verdict = verdictFor({ ...base, attempts: 5 }, true, options);
    expect(verdict).toEqual({ ok: false, reason: 'locked', attemptsLeft: 0 });
  });

  it('counts down attemptsLeft on mismatch', () => {
    expect(verdictFor({ ...base, attempts: 3 }, false, options)).toEqual({
      ok: false,
      reason: 'mismatch',
      attemptsLeft: 1,
    });
    expect(verdictFor({ ...base, attempts: 4 }, false, options)).toEqual({
      ok: false,
      reason: 'mismatch',
      attemptsLeft: 0,
    });
  });
});

describe('helpers', () => {
  it('validates code shape', () => {
    expect(isOtpCodeShape('012345')).toBe(true);
    expect(isOtpCodeShape('12345')).toBe(false);
    expect(isOtpCodeShape('1234567')).toBe(false);
    expect(isOtpCodeShape('abcdef')).toBe(false);
    expect(isOtpCodeShape(123456)).toBe(false);
  });

  it('normalizes email targets', () => {
    expect(normalizeEmailTarget('  Lan@Example.COM ')).toBe('lan@example.com');
    expect(normalizeEmailTarget('not-an-email')).toBeNull();
    expect(normalizeEmailTarget('a@b')).toBeNull();
    expect(normalizeEmailTarget(42)).toBeNull();
  });

  it('issues url-safe 32-byte tokens and uuid challenges', () => {
    expect(generateBearerToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generateChallengeId()).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
