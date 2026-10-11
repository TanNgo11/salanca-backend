const TOKEN = '{orderCode}';

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Pulls the order code out of a transfer description. The template is the same string the QR
 * memo was built from (`SLC{orderCode}` → content `SLCSLC-000124` → code `SLC-000124`).
 * Extra words around the memo are ignored. A missing placeholder, or text that does not contain
 * the prefix and suffix, returns null so the payment stays in review as `no-code`.
 */
export const extractOrderCode = (template: string, content: string | null | undefined): string | null => {
  const at = template.indexOf(TOKEN);
  if (at < 0 || !content) return null;
  const prefix = template.slice(0, at);
  const suffix = template.slice(at + TOKEN.length);
  const code = suffix.length > 0
    ? `([A-Za-z0-9][A-Za-z0-9/-]{0,40}?)`
    : `([A-Za-z0-9][A-Za-z0-9/-]{0,40})`;
  const pattern = new RegExp(`${escapeRegExp(prefix)}${code}${escapeRegExp(suffix)}`);
  const found = pattern.exec(content);
  return found?.[1] ?? null;
};
