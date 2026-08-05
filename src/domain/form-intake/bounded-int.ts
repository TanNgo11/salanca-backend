/**
 * Shared integer parsing for public form intake (number or digit string).
 */

import type { FormFail } from './form-validation-error';

export type BoundedIntOptions = {
  min: number;
  max: number;
  requiredCode: string;
  invalidCode: string;
  fieldLabel: string;
};

/**
 * Accepts integer number or base-10 digit string (no leading zeros / signs beyond plain digits).
 * Rejects floats, "08", "4.0", empty.
 */
export const parseBoundedInt = (
  fail: FormFail,
  value: unknown,
  options: BoundedIntOptions,
): number => {
  const { min, max, requiredCode, invalidCode, fieldLabel } = options;

  let parsed: number;
  if (typeof value === 'number' && Number.isInteger(value)) {
    parsed = value;
  } else if (typeof value === 'string' && value.trim() !== '') {
    const trimmed = value.trim();
    const n = Number.parseInt(trimmed, 10);
    // Reject non-canonical strings ("08", "+4", "4.0") so bounds stay exact.
    if (!Number.isFinite(n) || String(n) !== trimmed) {
      return fail(invalidCode, `${fieldLabel} must be an integer.`);
    }
    parsed = n;
  } else if (value == null || value === '') {
    return fail(requiredCode, `${fieldLabel} is required.`);
  } else {
    return fail(invalidCode, `${fieldLabel} must be an integer.`);
  }

  if (parsed < min || parsed > max) {
    return fail(invalidCode, `${fieldLabel} must be between ${min} and ${max}.`);
  }
  return parsed;
};
