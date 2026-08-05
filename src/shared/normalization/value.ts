/**
 * Domain-neutral value narrowing shared by feature boundaries.
 *
 * These primitives only narrow or convert values. They never throw feature
 * errors, decide required/optional/publishable policy, or know about Strapi.
 */

/** Accepts any non-null, non-array object, including null-prototype records and class instances. */
export const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Returns the trimmed string only for non-empty string input.
 * Wrong type, empty, and whitespace-only input return `null`. Never throws.
 */
export const trimmedNonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
