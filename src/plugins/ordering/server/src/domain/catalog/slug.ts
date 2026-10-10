import { LOCALIZED_TEXT_MAX_SLUG } from './localized-text';

/**
 * Per-locale slug derivation (contracts §20.1, plan step 3): staff may type a localized slug,
 * otherwise the localized name is normalized — lowercase, Vietnamese diacritics stripped
 * (including đ → d, which survives Unicode NFD unchanged), non-alphanumerics collapsed to `-`.
 * Pure functions; the catalog-slug service applies them to the database.
 */

export const slugify = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd') // đ does not decompose under NFD — replace explicitly
    .replace(/Đ/g, 'd')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, LOCALIZED_TEXT_MAX_SLUG)
    .replace(/-+$/g, '');

const asLocaleMap = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

/**
 * Computes the desired slug row for every locale the entity has content in. A non-empty
 * provided slug wins over the derived one; both are normalized so typed slugs and generated
 * slugs share one alphabet. Locales that normalize to nothing produce no row.
 */
export function desiredSlugs(input: { name?: unknown; slug?: unknown }): Map<string, string> {
  const nameMap = asLocaleMap(input.name);
  const slugMap = asLocaleMap(input.slug);
  const locales = new Set([...Object.keys(nameMap), ...Object.keys(slugMap)]);
  const desired = new Map<string, string>();
  for (const locale of locales) {
    const provided = typeof slugMap[locale] === 'string' ? slugMap[locale] : '';
    const raw = provided.trim().length > 0 ? provided : nameMap[locale];
    const slug = typeof raw === 'string' ? slugify(raw) : '';
    if (slug.length > 0) desired.set(locale, slug);
  }
  return desired;
}
