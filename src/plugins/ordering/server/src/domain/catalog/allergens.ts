/**
 * O12 allergen + dietary vocabulary — the implementation lives in `shared/catalog` so the
 * admin custom fields and the server share one source (same split as modifier-groups).
 */
export {
  ALLERGEN_CODES,
  ALLERGEN_LABELS,
  DIETARY_LABELS,
  DIETARY_TAGS,
  allergenLabel,
  dietaryLabel,
  isAllergenCode,
  isDietaryTag,
  normalizeAllergens,
  normalizeDietaryTags,
  normalizeKitchenStation,
  sanitizeAllergens,
  sanitizeDietaryTags,
} from '../../../../shared/catalog/allergens';
export type {
  AllergenCode,
  AllergenField,
  DietaryTag,
  LocalizedLabel,
  ValidationResult,
} from '../../../../shared/catalog/allergens';
