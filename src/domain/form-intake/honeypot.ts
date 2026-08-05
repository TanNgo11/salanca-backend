/**
 * Request-only honeypot field `website`: must be absent or empty string.
 */

import type { FormFail } from './form-validation-error';

/**
 * Fails without leaking honeypot details when `website` is non-empty or non-string.
 */
export const assertHoneypotClear = (
  fail: FormFail,
  website: unknown,
  code: string,
  message: string,
): void => {
  if (website != null && (typeof website !== 'string' || website.trim().length > 0)) {
    fail(code, message);
  }
};
