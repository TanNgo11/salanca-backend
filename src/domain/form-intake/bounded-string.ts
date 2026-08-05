/**
 * Shared bounded-string parsers for public form intake.
 * Callers inject `fail` so feature-specific error codes stay local.
 */

import { trimmedNonEmptyString } from '../../shared/normalization/value';
import type { FormFail } from './form-validation-error';

export type { FormFail };

/**
 * Optional string: absent/blank → undefined; non-string → invalidBodyCode; over max → tooLongCode.
 */
export const optionalBoundedString = (
  fail: FormFail,
  value: unknown,
  max: number,
  tooLongCode: string,
  fieldLabel: string,
  invalidBodyCode: string,
): string | undefined => {
  if (value == null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    return fail(invalidBodyCode, 'Optional string fields must be strings when provided.');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  if (trimmed.length > max) {
    return fail(tooLongCode, `${fieldLabel} must be at most ${max} characters.`);
  }
  return trimmed;
};

/**
 * Required string: trim + non-empty + max length.
 */
export const requiredBoundedString = (
  fail: FormFail,
  value: unknown,
  max: number,
  requiredCode: string,
  tooLongCode: string,
  fieldLabel: string,
): string => {
  const trimmed = trimmedNonEmptyString(value);
  if (!trimmed) {
    return fail(requiredCode, `${fieldLabel} is required.`);
  }
  if (trimmed.length > max) {
    return fail(tooLongCode, `${fieldLabel} must be at most ${max} characters.`);
  }
  return trimmed;
};
