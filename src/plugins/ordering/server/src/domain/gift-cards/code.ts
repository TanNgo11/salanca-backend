import { createHmac, randomBytes } from 'node:crypto';

/**
 * Gift-card codes (O9 plan step 1). A code is 16 characters from a 30-symbol alphabet —
 * A–Z plus 2–9 without the lookalikes O, I, L, 0, 1 — displayed as `XXXX-XXXX-XXXX-XXXX`.
 * Only the keyed HMAC of the normalized code and its last four characters are ever stored;
 * the plaintext exists in the recipient email and in a 24-hour sealed copy for one-time
 * staff display.
 */
export const GIFT_CARD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const GIFT_CARD_CODE_LENGTH = 16;

const ALPHABET_SET = new Set(GIFT_CARD_ALPHABET.split(''));

/** 16 unambiguous characters from crypto-random; the caller retries on a hash collision. */
export function generateGiftCardCode(): string {
  // One randomBytes call per code; bytes >= 240 are discarded so `byte % 30` stays uniform.
  const limit = 256 - (256 % GIFT_CARD_ALPHABET.length);
  const chars: string[] = [];
  while (chars.length < GIFT_CARD_CODE_LENGTH) {
    const bytes = randomBytes(GIFT_CARD_CODE_LENGTH * 2);
    for (const byte of bytes) {
      if (byte >= limit || chars.length === GIFT_CARD_CODE_LENGTH) continue;
      chars.push(GIFT_CARD_ALPHABET[byte % GIFT_CARD_ALPHABET.length]);
    }
  }
  return chars.join('');
}

/**
 * User input → the stored form: drop dashes and whitespace, uppercase, then require exactly
 * 16 alphabet characters. Returns `null` for anything else — callers must not distinguish
 * "bad format" from "unknown code" (that would be a probing oracle).
 */
export function normalizeGiftCardCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const normalized = input.replace(/[\s-]/g, '').toUpperCase();
  if (normalized.length !== GIFT_CARD_CODE_LENGTH) return null;
  for (const char of normalized) {
    if (!ALPHABET_SET.has(char)) return null;
  }
  return normalized;
}

/** `ABCDEFGHJKMNPQRS` → `ABCD-EFGH-JKMN-PQRS` for display and emails. */
export function formatGiftCardCode(normalized: string): string {
  const parts: string[] = [];
  for (let index = 0; index < normalized.length; index += 4) {
    parts.push(normalized.slice(index, index + 4));
  }
  return parts.join('-');
}

/** The only code fragment that may appear in logs, Admin views or public views. */
export function last4Of(normalized: string): string {
  return normalized.slice(-4);
}

/** `HMAC-SHA256(key, 'gift-card:' + normalized)` — keyed so a table dump cannot be brute-forced. */
export function giftCardCodeHash(hmacKey: Buffer, normalized: string): string {
  return createHmac('sha256', hmacKey).update(`gift-card:${normalized}`).digest('hex');
}
