import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * AES-256-GCM for short secrets the plugin must read back (contracts §21.10: the order token kept
 * on the idempotency record so a replayed create returns the same link). The key is 32 bytes,
 * base64-encoded, supplied by the app through plugin config — never read from `process.env`
 * here. Ciphertexts carry a key-version prefix (`v1:`) so the key can rotate later.
 *
 * Format: `v1:<iv>.<tag>.<ciphertext>`, each part base64url.
 */
const VERSION = 'v1';
const IV_BYTES = 12;

export type KeyCheck = { valid: true; key: Buffer } | { valid: false; reason: 'missing' | 'format' };

export function parseEncryptionKey(raw: unknown): KeyCheck {
  if (typeof raw !== 'string' || raw.trim() === '') return { valid: false, reason: 'missing' };
  const trimmed = raw.trim();
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return { valid: false, reason: 'format' };
  const key = Buffer.from(trimmed.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  return key.length === 32 ? { valid: true, key } : { valid: false, reason: 'format' };
}

export function encryptSecret(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString('base64url')}.${tag.toString('base64url')}.${body.toString('base64url')}`;
}

/** Throws on a wrong key, a tampered value or an unknown version. */
export function decryptSecret(sealed: string, key: Buffer): string {
  const [version, rest] = sealed.split(':', 2);
  if (version !== VERSION || !rest) throw new Error('unsupported ciphertext version');
  const [iv, tag, body] = rest.split('.');
  if (!iv || !tag || body === undefined) throw new Error('malformed ciphertext');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(body, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}
