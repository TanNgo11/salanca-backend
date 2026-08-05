/**
 * Single-address email check shared by config env validation and form intake.
 * Intentionally strict enough to reject obvious garbage; not a full RFC 5322 parser.
 */
export const emailAddressPattern = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;

export const isValidEmailAddress = (value: string): boolean =>
  emailAddressPattern.test(value);
