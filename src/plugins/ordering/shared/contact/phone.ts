/**
 * Vietnamese phone validation and E.164 normalization (contracts §21.2, §21.9). Shared by the
 * server (order create, lookup) and the admin "Tạo đơn hộ" form, so it must stay dependency-free.
 *
 * Accepted inputs: national form starting with `0`, or international with `+84` / `84`. Spaces,
 * dots, dashes and parentheses are ignored. Valid numbers: mobile `0[35789]` + 8 digits (10
 * digits) and fixed line `02` + 9 digits (11 digits).
 */
export type PhoneResult =
  | { valid: true; e164: string; national: string }
  | { valid: false; reason: 'empty' | 'format' };

const MOBILE = /^0[35789]\d{8}$/;
const FIXED = /^02\d{9}$/;

export function normalizeVietnamesePhone(input: unknown): PhoneResult {
  if (typeof input !== 'string') return { valid: false, reason: 'empty' };
  const compact = input.replace(/[\s.\-()]/g, '');
  if (compact === '') return { valid: false, reason: 'empty' };
  let national: string;
  if (compact.startsWith('+84')) national = `0${compact.slice(3)}`;
  else if (compact.startsWith('84') && compact.length >= 11) national = `0${compact.slice(2)}`;
  else national = compact;
  if (!/^\d+$/.test(national) || !(MOBILE.test(national) || FIXED.test(national))) {
    return { valid: false, reason: 'format' };
  }
  return { valid: true, national, e164: `+84${national.slice(1)}` };
}

/** `0901234567` → `090•••4567` for list views; full numbers only on the detail page. */
export function maskPhone(national: string): string {
  if (national.length < 7) return '•••';
  return `${national.slice(0, 3)}•••${national.slice(-4)}`;
}
