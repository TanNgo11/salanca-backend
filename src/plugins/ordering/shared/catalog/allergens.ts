/**
 * O12 allergen + dietary vocabulary (plan step 4): the fixed EU FIC 14-code allergen table
 * plus `custom:<name>` free entries, the dietary label list, and category `kitchenStation`
 * normalization. Codes live on `catalog-product`; labels resolve per locale here so the
 * admin form, the public catalog serializer and KDS share one source of truth.
 */

export type LocalizedLabel = { vi: string; en: string };

export const ALLERGEN_CODES = [
  'gluten',
  'crustacean',
  'egg',
  'fish',
  'peanut',
  'soy',
  'milk',
  'nut',
  'celery',
  'mustard',
  'sesame',
  'sulfite',
  'lupin',
  'mollusc',
] as const;

export type AllergenCode = (typeof ALLERGEN_CODES)[number];

export const ALLERGEN_LABELS: Record<AllergenCode, LocalizedLabel> = {
  gluten: { vi: 'Gluten', en: 'Gluten' },
  crustacean: { vi: 'Giáp xác', en: 'Crustaceans' },
  egg: { vi: 'Trứng', en: 'Eggs' },
  fish: { vi: 'Cá', en: 'Fish' },
  peanut: { vi: 'Đậu phộng', en: 'Peanuts' },
  soy: { vi: 'Đậu nành', en: 'Soy' },
  milk: { vi: 'Sữa', en: 'Milk' },
  nut: { vi: 'Hạt cây', en: 'Tree nuts' },
  celery: { vi: 'Cần tây', en: 'Celery' },
  mustard: { vi: 'Mù tạt', en: 'Mustard' },
  sesame: { vi: 'Mè', en: 'Sesame' },
  sulfite: { vi: 'Sulfit', en: 'Sulfites' },
  lupin: { vi: 'Đậu lupin', en: 'Lupin' },
  mollusc: { vi: 'Nhuyễn thể', en: 'Molluscs' },
};

export const DIETARY_TAGS = [
  'vegetarian',
  'vegan',
  'halal',
  'gluten-free',
  'sugar-free',
  'spicy',
] as const;

export type DietaryTag = (typeof DIETARY_TAGS)[number];

export const DIETARY_LABELS: Record<DietaryTag, LocalizedLabel> = {
  vegetarian: { vi: 'Chay', en: 'Vegetarian' },
  vegan: { vi: 'Thuần chay', en: 'Vegan' },
  halal: { vi: 'Halal', en: 'Halal' },
  'gluten-free': { vi: 'Không gluten', en: 'Gluten-free' },
  'sugar-free': { vi: 'Không đường', en: 'Sugar-free' },
  spicy: { vi: 'Cay', en: 'Spicy' },
};

const ALLERGEN_SET = new Set<string>(ALLERGEN_CODES);
const DIETARY_SET = new Set<string>(DIETARY_TAGS);

const CUSTOM_PREFIX = 'custom:';
const CUSTOM_NAME_MAX = 60;
const KITCHEN_STATION_MAX = 64;

export const isAllergenCode = (code: string): boolean =>
  ALLERGEN_SET.has(code) || code.startsWith(CUSTOM_PREFIX);

export const isDietaryTag = (code: string): boolean => DIETARY_SET.has(code);

/** `custom:` entries keep a trimmed, bounded name — the label IS the name. */
const validCustom = (code: string): boolean => {
  const name = code.slice(CUSTOM_PREFIX.length);
  return name.length > 0 && name.length <= CUSTOM_NAME_MAX && !name.includes(',');
};

export type AllergenField = 'allergens' | 'dietaryTags';

export type ValidationResult =
  | { valid: true; value: string[] }
  | { valid: false; message: string; details?: Record<string, unknown> };

const normalizeCodes = (
  input: unknown,
  field: AllergenField,
  accept: (code: string) => boolean,
): ValidationResult => {
  if (input === undefined || input === null) return { valid: true, value: [] };
  if (!Array.isArray(input)) {
    return { valid: false, message: `${field} must be an array of codes` };
  }
  const seen = new Set<string>();
  const value: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') {
      return { valid: false, message: `${field} entries must be strings` };
    }
    const raw = item.trim();
    if (raw === '') continue;
    // `custom:` entries keep the original name casing — the name doubles as the label.
    const code = raw.toLowerCase().startsWith(CUSTOM_PREFIX)
      ? `${CUSTOM_PREFIX}${raw.slice(CUSTOM_PREFIX.length).trim()}`
      : raw.toLowerCase();
    if (field === 'allergens' && code.startsWith(CUSTOM_PREFIX) && !validCustom(code)) {
      return {
        valid: false,
        message: `${field} custom names must be 1-${CUSTOM_NAME_MAX} chars without commas`,
        details: { field, code },
      };
    }
    if (!accept(code)) {
      return {
        valid: false,
        message: `${field} contains an unknown code`,
        details: { field, code },
      };
    }
    if (!seen.has(code.toLowerCase())) {
      seen.add(code.toLowerCase());
      value.push(code);
    }
  }
  return { valid: true, value };
};

export const normalizeAllergens = (input: unknown): ValidationResult =>
  normalizeCodes(input, 'allergens', isAllergenCode);

export const normalizeDietaryTags = (input: unknown): ValidationResult =>
  normalizeCodes(input, 'dietaryTags', isDietaryTag);

/**
 * Read-time normalization for rows written before the validators existed (or via
 * db.query bypass): unknown/malformed entries drop silently instead of leaking.
 */
const sanitize = (input: unknown, accept: (code: string) => boolean): string[] => {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const value: string[] = [];
  for (const item of input) {
    if (typeof item !== 'string') continue;
    const raw = item.trim();
    const code = raw.toLowerCase().startsWith(CUSTOM_PREFIX)
      ? `${CUSTOM_PREFIX}${raw.slice(CUSTOM_PREFIX.length).trim()}`
      : raw.toLowerCase();
    if (!accept(code) || (code.startsWith(CUSTOM_PREFIX) && !validCustom(code))) continue;
    if (!seen.has(code.toLowerCase())) {
      seen.add(code.toLowerCase());
      value.push(code);
    }
  }
  return value;
};
export const sanitizeAllergens = (input: unknown): string[] => sanitize(input, isAllergenCode);
export const sanitizeDietaryTags = (input: unknown): string[] => sanitize(input, isDietaryTag);

export const allergenLabel = (code: string, locale: string, fallback = 'vi'): string => {
  if (code.startsWith(CUSTOM_PREFIX)) return code.slice(CUSTOM_PREFIX.length);
  const labels = ALLERGEN_LABELS[code as AllergenCode];
  return labels?.[locale as keyof LocalizedLabel] ?? labels?.[fallback as keyof LocalizedLabel] ?? code;
};

export const dietaryLabel = (code: string, locale: string, fallback = 'vi'): string => {
  const labels = DIETARY_LABELS[code as DietaryTag];
  return labels?.[locale as keyof LocalizedLabel] ?? labels?.[fallback as keyof LocalizedLabel] ?? code;
};

/** `kitchenStation` is a free string — trim, bound, empty → undefined. */
export const normalizeKitchenStation = (input: unknown): string | null => {
  if (typeof input !== 'string') return null;
  const value = input.trim();
  if (value === '' || value.length > KITCHEN_STATION_MAX) return null;
  return value;
};
