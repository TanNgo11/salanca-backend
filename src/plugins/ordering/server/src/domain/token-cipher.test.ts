import { randomBytes } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { decryptSecret, encryptSecret, parseEncryptionKey } from './token-cipher';

const rawKey = randomBytes(32).toString('base64');
const key = (() => {
  const parsed = parseEncryptionKey(rawKey);
  if (!parsed.valid) throw new Error('test key invalid');
  return parsed.key;
})();

describe('token cipher', () => {
  it('round-trips with a version prefix and a fresh IV each time', () => {
    const a = encryptSecret('order-token-123', key);
    const b = encryptSecret('order-token-123', key);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toBe(b);
    expect(decryptSecret(a, key)).toBe('order-token-123');
  });

  it('rejects a tampered ciphertext and a wrong key', () => {
    const sealed = encryptSecret('order-token-123', key);
    const body = sealed.slice(sealed.lastIndexOf('.') + 1);
    const flipped = `${body[0] === 'A' ? 'B' : 'A'}${body.slice(1)}`;
    expect(() => decryptSecret(`${sealed.slice(0, sealed.lastIndexOf('.') + 1)}${flipped}`, key)).toThrow();
    expect(() => decryptSecret(sealed, randomBytes(32))).toThrow();
    expect(() => decryptSecret('v2:abc.def.ghi', key)).toThrow();
  });

  it('accepts only 32-byte base64 keys', () => {
    expect(parseEncryptionKey(undefined)).toEqual({ valid: false, reason: 'missing' });
    expect(parseEncryptionKey('  ')).toEqual({ valid: false, reason: 'missing' });
    expect(parseEncryptionKey(randomBytes(16).toString('base64'))).toEqual({
      valid: false,
      reason: 'format',
    });
    expect(parseEncryptionKey('not base64!!')).toEqual({ valid: false, reason: 'format' });
    expect(parseEncryptionKey(randomBytes(32).toString('base64url')).valid).toBe(true);
  });
});
