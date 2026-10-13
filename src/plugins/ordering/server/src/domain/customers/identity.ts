import { createHmac } from 'node:crypto';

import { OrderingError } from '../errors';
import { sha256Hex } from '../hashing';
import { parseEncryptionKey } from '../token-cipher';

/**
 * O11 keyed hashes (plan decisions): customer phone, OTP targets/codes are HMAC'd with the
 * plugin encryption key so a table dump cannot be brute-forced against the ~10⁹ VN phone space.
 * Session/cart tokens are 256-bit random — plain SHA-256 is enough there (same as the order
 * token). The HMAC key material is the encryption key; when it is absent (dev/test without
 * ORDERING_ENCRYPTION_KEY) a fixed dev key keeps migration and runtime hashes consistent —
 * production boots with a real key or refuses order creation already.
 */
const DEV_FALLBACK_KEY = 'ordering-o11-dev-hash-key!!32bytes';

const hashKey = (encryptionKey: string | undefined): Buffer => {
  const parsed = parseEncryptionKey(encryptionKey ?? '');
  return parsed.valid ? parsed.key : Buffer.from(DEV_FALLBACK_KEY.padEnd(32, '!').slice(0, 32));
};

const hmac = (key: Buffer, scope: string, value: string): string =>
  createHmac('sha256', key).update(`${scope}:${value}`).digest('hex');

export type O11Hashing = {
  /** Irreversible lookup key for a normalized E.164 phone (`customer.phoneHash`). */
  phoneHash: (e164: string) => string;
  /** Lookup key for an OTP target (email lowercased, or E.164 phone for O13). */
  otpTargetHash: (target: string) => string;
  /** `HMAC(key, code + challengeId)` — the stored form of a one-time code. */
  otpCodeHash: (code: string, challengeId: string) => string;
  /** Session bearer token → stored hash. */
  sessionTokenHash: (token: string) => string;
  /** Guest cart token → stored hash. */
  cartTokenHash: (token: string) => string;
};

export const o11Hashing = (encryptionKey: string | undefined): O11Hashing => {
  const key = hashKey(encryptionKey);
  return {
    phoneHash: (e164) => hmac(key, 'customer-phone', e164),
    otpTargetHash: (target) => hmac(key, 'otp-target', target),
    otpCodeHash: (code, challengeId) => hmac(key, 'otp-code', `${challengeId}:${code}`),
    sessionTokenHash: (token) => sha256Hex(token),
    cartTokenHash: (token) => sha256Hex(token),
  };
};

/** Config accessor shared by the services (avoids repeating the parse in three places). */
export const hashingForConfig = (config: { encryptionKey?: string }): O11Hashing =>
  o11Hashing(config.encryptionKey);

/** Throws when the value is not a 64-char hex digest — keeps detail free of the secret itself. */
export const assertHexHash = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) {
    throw new OrderingError('VALIDATION_ERROR', `${field} must be a SHA-256/HMAC hex digest`, {
      details: { field },
    });
  }
  return value.toLowerCase();
};
