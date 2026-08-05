/**
 * Public form locale of the submitting page (not Strapi i18n plugin locale).
 */

import { trimmedNonEmptyString } from '../../shared/normalization/value';
import type { FormFail } from './form-validation-error';

export type FormSourceLocale = 'vi' | 'en';

const isSourceLocale = (value: string): value is FormSourceLocale =>
  value === 'vi' || value === 'en';

/**
 * Reads `sourceLocale`, with legacy body key `locale` as alias.
 */
export const parseFormSourceLocale = (
  fail: FormFail,
  raw: Record<string, unknown>,
  invalidCode: string,
): FormSourceLocale => {
  const sourceLocaleRaw =
    trimmedNonEmptyString(raw.sourceLocale) ?? trimmedNonEmptyString(raw.locale);
  if (!sourceLocaleRaw || !isSourceLocale(sourceLocaleRaw)) {
    return fail(invalidCode, 'sourceLocale must be "vi" or "en".');
  }
  return sourceLocaleRaw;
};
