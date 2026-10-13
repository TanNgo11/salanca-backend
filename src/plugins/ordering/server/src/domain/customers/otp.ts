import { randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

import type { O11Hashing } from './identity';

/**
 * OTP primitives (O11, plan step 2): 6-digit codes from `crypto.randomInt`, stored only as
 * `HMAC(encryptionKey, code + challengeId)` (identity.ts), compared with `timingSafeEqual`.
 * Pure functions — the service owns persistence; this module owns code shape and comparison.
 */

export const OTP_CODE_LENGTH = 6;

/** `000000`–`999999`, zero-padded. `randomInt` is unbiased CSPRNG. */
export const generateOtpCode = (): string =>
  String(randomInt(0, 10 ** OTP_CODE_LENGTH)).padStart(OTP_CODE_LENGTH, '0');

/** A fresh opaque challenge id (uuid) — public identifier of an OTP row. */
export const generateChallengeId = (): string => randomUUID();

/** 32-byte URL-safe bearer secret for sessions and guest cart tokens. */
export const generateBearerToken = (): string => randomBytes(32).toString('base64url');

/** Client input must be exactly 6 digits — anything else fails before hashing work. */
export const isOtpCodeShape = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{6}$/.test(value);

/**
 * Constant-time compare of a candidate code against the stored HMAC. The digests are hex
 * strings of fixed length; unequal length means a malformed stored hash, not a match.
 */
export const otpCodeMatches = (
  hashing: Pick<O11Hashing, 'otpCodeHash'>,
  code: string,
  challengeId: string,
  storedCodeHash: string,
): boolean => {
  const candidate = hashing.otpCodeHash(code, challengeId);
  if (candidate.length !== storedCodeHash.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(storedCodeHash));
};

/** OTP email target: trim + lowercase so `TargetHash` lookups and `customer.email` agree. */
export const normalizeEmailTarget = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
};

export type ChallengeVerdict =
  | { ok: true }
  | { ok: false; reason: 'expired' | 'consumed' | 'locked' | 'mismatch'; attemptsLeft: number };

/**
 * Decides a verification attempt. `now` is injectable for tests; on `mismatch` the caller
 * increments `attempts` before answering (attemptsLeft already accounts for this failure).
 */
export const verdictFor = (
  challenge: { attempts: number; expiresAt: Date; consumedAt: Date | null },
  codeOk: boolean,
  options: { now: Date; maxAttempts: number },
): ChallengeVerdict => {
  if (challenge.consumedAt) return { ok: false, reason: 'consumed', attemptsLeft: 0 };
  if (challenge.expiresAt.getTime() <= options.now.getTime()) {
    return { ok: false, reason: 'expired', attemptsLeft: 0 };
  }
  if (challenge.attempts >= options.maxAttempts) {
    return { ok: false, reason: 'locked', attemptsLeft: 0 };
  }
  if (!codeOk) {
    return {
      ok: false,
      reason: 'mismatch',
      attemptsLeft: Math.max(0, options.maxAttempts - challenge.attempts - 1),
    };
  }
  return { ok: true };
};
