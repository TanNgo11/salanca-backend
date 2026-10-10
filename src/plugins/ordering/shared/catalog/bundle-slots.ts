import {
  assertStrictKeys,
  isNumber,
  isRecord,
  isValidationFailure,
  receivedType,
  type ValidationResult,
  validationFailure,
} from './validation';

export type BundleSlotItem = {
  variantRef: string;
  quantity: number;
  isDefault: boolean;
  priceDelta: number;
};

export type BundleSlot = {
  key: string;
  name: Record<string, string>;
  selection: 'single' | 'multiple';
  required: boolean;
  min: number;
  max: number;
  rank: number;
  items: BundleSlotItem[];
};

export type BundleSlotsValidation = ValidationResult<BundleSlot[]>;

const slotKeys = ['key', 'name', 'selection', 'required', 'min', 'max', 'rank', 'items'] as const;
const itemKeys = ['variantRef', 'quantity', 'isDefault', 'priceDelta'] as const;

function parseString(
  field: string,
  value: unknown,
  path: (string | number)[],
  min?: number,
  max?: number,
): string | ReturnType<typeof validationFailure> {
  if (typeof value !== 'string') {
    return validationFailure(field, path, 'invalid_type', `Expected string, received ${receivedType(value)}`);
  }
  if (min !== undefined && value.length < min) {
    return validationFailure(field, path, 'too_small', `String must contain at least ${min} character(s)`);
  }
  if (max !== undefined && value.length > max) {
    return validationFailure(field, path, 'too_big', `String must contain at most ${max} character(s)`);
  }
  return value;
}

function parseInteger(
  field: string,
  value: unknown,
  path: (string | number)[],
  min = 0,
): number | ReturnType<typeof validationFailure> {
  if (!isNumber(value)) {
    return validationFailure(field, path, 'invalid_type', `Expected number, received ${receivedType(value)}`);
  }
  if (!Number.isInteger(value)) {
    return validationFailure(field, path, 'invalid_type', `Expected integer, received float`);
  }
  if (value < min) {
    return validationFailure(field, path, 'too_small', `Number must be greater than or equal to ${min}`);
  }
  return value;
}

function parseName(value: unknown, path: (string | number)[]): Record<string, string> | ReturnType<typeof validationFailure> {
  if (!isRecord(value)) {
    return validationFailure('bundleSlots', path, 'invalid_type', `Expected object, received ${receivedType(value)}`);
  }
  for (const [locale, text] of Object.entries(value)) {
    if (typeof text !== 'string') {
      return validationFailure('bundleSlots', [...path, locale], 'invalid_type', `Expected string, received ${receivedType(text)}`);
    }
  }
  return { ...value } as Record<string, string>;
}

function parseItem(value: unknown, path: (string | number)[]): BundleSlotItem | ReturnType<typeof validationFailure> {
  if (!isRecord(value)) {
    return validationFailure('bundleSlots', path, 'invalid_type', `Expected object, received ${receivedType(value)}`);
  }
  const strict = assertStrictKeys('bundleSlots', value, itemKeys, path);
  if (strict) return strict;
  for (const key of itemKeys) {
    if (!(key in value)) return validationFailure('bundleSlots', [...path, key], 'invalid_type', 'Required');
  }
  const variantRef = parseString('bundleSlots', value.variantRef, [...path, 'variantRef'], 1);
  if (typeof variantRef !== 'string') return variantRef;
  const quantity = parseInteger('bundleSlots', value.quantity, [...path, 'quantity'], 1);
  if (typeof quantity !== 'number') return quantity;
  if (typeof value.isDefault !== 'boolean') {
    return validationFailure('bundleSlots', [...path, 'isDefault'], 'invalid_type', `Expected boolean, received ${receivedType(value.isDefault)}`);
  }
  const priceDelta = parseInteger('bundleSlots', value.priceDelta, [...path, 'priceDelta'], Number.MIN_SAFE_INTEGER);
  if (typeof priceDelta !== 'number') return priceDelta;
  return { variantRef, quantity, isDefault: value.isDefault, priceDelta };
}

function parseSlot(value: unknown, path: (string | number)[]): BundleSlot | ReturnType<typeof validationFailure> {
  if (!isRecord(value)) {
    return validationFailure('bundleSlots', path, 'invalid_type', `Expected object, received ${receivedType(value)}`);
  }
  const strict = assertStrictKeys('bundleSlots', value, slotKeys, path);
  if (strict) return strict;
  for (const key of slotKeys) {
    if (!(key in value)) return validationFailure('bundleSlots', [...path, key], 'invalid_type', 'Required');
  }
  const key = parseString('bundleSlots', value.key, [...path, 'key'], 1, 50);
  if (typeof key !== 'string') return key;
  const name = parseName(value.name, [...path, 'name']);
  if (isValidationFailure(name)) return name;
  if (value.selection !== 'single' && value.selection !== 'multiple') {
    return validationFailure('bundleSlots', [...path, 'selection'], 'invalid_enum_value', "Invalid enum value. Expected 'single' | 'multiple'");
  }
  if (typeof value.required !== 'boolean') {
    return validationFailure('bundleSlots', [...path, 'required'], 'invalid_type', `Expected boolean, received ${receivedType(value.required)}`);
  }
  const min = parseInteger('bundleSlots', value.min, [...path, 'min']);
  if (typeof min !== 'number') return min;
  const max = parseInteger('bundleSlots', value.max, [...path, 'max']);
  if (typeof max !== 'number') return max;
  const rank = parseInteger('bundleSlots', value.rank, [...path, 'rank']);
  if (typeof rank !== 'number') return rank;
  if (!Array.isArray(value.items)) {
    return validationFailure('bundleSlots', [...path, 'items'], 'invalid_type', `Expected array, received ${receivedType(value.items)}`);
  }
  if (value.items.length > 100) {
    return validationFailure('bundleSlots', [...path, 'items'], 'too_big', 'Array must contain at most 100 element(s)');
  }
  const items: BundleSlotItem[] = [];
  for (let index = 0; index < value.items.length; index += 1) {
    const item = parseItem(value.items[index], [...path, 'items', index]);
    if (isValidationFailure(item)) return item;
    items.push(item as BundleSlotItem);
  }
  return { key, name, selection: value.selection, required: value.required, min, max, rank, items };
}

/** Browser-safe structural validation. Database reference checks stay in server/. */
export function validateBundleSlots(raw: unknown): BundleSlotsValidation {
  if (raw === null || raw === undefined) return { valid: true, value: [] };
  if (!Array.isArray(raw)) {
    return validationFailure('bundleSlots', [], 'invalid_type', `Expected array, received ${receivedType(raw)}`);
  }
  if (raw.length > 20) {
    return validationFailure('bundleSlots', [], 'too_big', 'Array must contain at most 20 element(s)');
  }
  const value: BundleSlot[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const slot = parseSlot(raw[index], [index]);
    if (isValidationFailure(slot)) return slot;
    const parsed = slot as BundleSlot;
    if (seen.has(parsed.key)) {
      return validationFailure('bundleSlots', [index, 'key'], 'custom', `${index}.key is duplicated`, { index });
    }
    seen.add(parsed.key);
    if (parsed.selection === 'single' && parsed.max > 1) {
      return validationFailure('bundleSlots', [index], 'custom', `${index} is a single-choice slot but allows max ${parsed.max}`, { index });
    }
    if (parsed.max > 0 && parsed.min > parsed.max) {
      return validationFailure('bundleSlots', [index], 'custom', `${index} has min > max`, { index });
    }
    if (parsed.required && parsed.min === 0) {
      return validationFailure('bundleSlots', [index], 'custom', `${index} is required but allows choosing nothing (min 0)`, { index });
    }
    value.push(parsed);
  }
  return { valid: true, value };
}
