const VIETNAMESE_COPY_PATTERN =
  /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/iu;

/** Prevent English/framework response text from leaking into Vietnamese Admin UI. */
export const safeVietnameseAdminMessage = (
  candidate: unknown,
  fallback: string,
): string => {
  if (typeof candidate !== 'string') return fallback;
  const normalized = [...candidate]
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127 ? ' ' : character;
    })
    .join('')
    .trim();
  return normalized.length > 0 && normalized.length <= 300 && VIETNAMESE_COPY_PATTERN.test(normalized)
    ? normalized
    : fallback;
};
