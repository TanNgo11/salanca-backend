/**
 * `localized-text` custom field: a JSON object `{ <locale>: <string> }` keyed by the locales
 * enabled in Strapi i18n (contracts §20.1). One record holds every translation so prices,
 * relations and flags never diverge between languages. Pure validation lives here; the
 * Document Service middleware applies it with the app's enabled locale list.
 */
export type LocalizedText = Record<string, string>;

export const LOCALIZED_TEXT_MAX_NAME = 200;
export const LOCALIZED_TEXT_MAX_DESCRIPTION = 2000;
export const LOCALIZED_TEXT_MAX_SLUG = 200;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export type LocalizedTextValidation =
  | { valid: true; value: LocalizedText }
  | { valid: false; message: string; details: { field?: string; locale?: string } };

/**
 * Validates a localized-text value. `required` asks for at least one non-empty translation —
 * not every locale, so a VI-only dish is a valid first draft. Unknown locale keys are
 * rejected: silently dropping them would lose text a staff member just typed.
 */
export function validateLocalizedText(
  raw: unknown,
  options: {
    enabledLocales: string[];
    maxLength?: number;
    required?: boolean;
    field?: string;
  },
): LocalizedTextValidation {
  const { enabledLocales, maxLength = LOCALIZED_TEXT_MAX_NAME, required = false, field } = options;
  if (raw === null || raw === undefined) {
    return required
      ? { valid: false, message: `${field ?? 'value'} requires at least one translation`, details: { field } }
      : { valid: true, value: {} };
  }
  if (!isPlainObject(raw)) {
    return {
      valid: false,
      message: `${field ?? 'value'} must be an object keyed by locale`,
      details: { field },
    };
  }
  const allowed = new Set(enabledLocales);
  const value: LocalizedText = {};
  let filled = 0;
  for (const [locale, text] of Object.entries(raw)) {
    if (!allowed.has(locale)) {
      return {
        valid: false,
        message: `${field ?? 'value'} has unsupported locale "${locale}"`,
        details: { field, locale },
      };
    }
    if (typeof text !== 'string') {
      return {
        valid: false,
        message: `${field ?? 'value'}.${locale} must be a string`,
        details: { field, locale },
      };
    }
    if (text.length > maxLength) {
      return {
        valid: false,
        message: `${field ?? 'value'}.${locale} exceeds ${maxLength} characters`,
        details: { field, locale },
      };
    }
    value[locale] = text;
    if (text.trim().length > 0) filled += 1;
  }
  if (required && filled === 0) {
    return {
      valid: false,
      message: `${field ?? 'value'} requires at least one non-empty translation`,
      details: { field },
    };
  }
  return { valid: true, value };
}

/**
 * Reads one locale out of a localized map with fallback: requested locale → default locale →
 * first non-empty value → undefined. Non-empty wins over a blank translation typed by mistake.
 */
export function resolveLocalizedText(
  value: unknown,
  locale: string,
  defaultLocale: string,
): string | undefined {
  if (!isPlainObject(value)) return undefined;
  const pick = (code: string): string | undefined => {
    const text = value[code];
    return typeof text === 'string' && text.trim().length > 0 ? text : undefined;
  };
  return pick(locale) ?? pick(defaultLocale) ?? Object.keys(value).map(pick).find((t) => t !== undefined);
}
