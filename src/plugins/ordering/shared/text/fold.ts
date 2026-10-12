/**
 * Accent-insensitive comparison for Vietnamese place names. `đ` is not a combining
 * mark, so NFD alone leaves it in place.
 */
export function foldDiacritics(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/đ/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}
