import {
  assertStrictKeys,
  isInteger,
  isNumber,
  isRecord,
  isValidationFailure,
  receivedType,
  type ValidationResult,
  validationFailure,
} from './validation';

export type ModifierOverride = { priceDelta?: number; isDefault?: boolean; hidden?: boolean };
export type ProductModifierGroup = {
  groupRef: string;
  required: boolean;
  min: number;
  max: number;
  freeQuantity: number;
  rank: number;
  overrides: Record<string, ModifierOverride>;
};
export type ModifierGroupsValidation = ValidationResult<ProductModifierGroup[]>;

export type ModifierLibrary = {
  groupDocumentIds: Set<string>;
  modifierDocumentIdsByGroup: Map<string, Set<string>>;
};

const groupKeys = ['groupRef', 'required', 'min', 'max', 'freeQuantity', 'rank', 'overrides'] as const;
const overrideKeys = ['priceDelta', 'isDefault', 'hidden'] as const;

function parseInteger(value: unknown, path: (string | number)[]): number | ReturnType<typeof validationFailure> {
  if (!isNumber(value)) return validationFailure('modifierGroups', path, 'invalid_type', `Expected number, received ${receivedType(value)}`);
  if (!isInteger(value)) return validationFailure('modifierGroups', path, 'invalid_type', 'Expected integer, received float');
  if (value < 0) return validationFailure('modifierGroups', path, 'too_small', 'Number must be greater than or equal to 0');
  return value;
}

function parseOverride(value: unknown, path: (string | number)[]): ModifierOverride | ReturnType<typeof validationFailure> {
  if (!isRecord(value)) return validationFailure('modifierGroups', path, 'invalid_type', `Expected object, received ${receivedType(value)}`);
  const strict = assertStrictKeys('modifierGroups', value, overrideKeys, path);
  if (strict) return strict;
  const result: ModifierOverride = {};
  if ('priceDelta' in value) {
    if (!isNumber(value.priceDelta) || !Number.isInteger(value.priceDelta)) {
      return validationFailure('modifierGroups', [...path, 'priceDelta'], 'invalid_type', `Expected integer, received ${receivedType(value.priceDelta)}`);
    }
    result.priceDelta = value.priceDelta;
  }
  for (const key of ['isDefault', 'hidden'] as const) {
    if (key in value) {
      if (typeof value[key] !== 'boolean') return validationFailure('modifierGroups', [...path, key], 'invalid_type', `Expected boolean, received ${receivedType(value[key])}`);
      result[key] = value[key];
    }
  }
  return result;
}

function parseGroup(value: unknown, path: (string | number)[]): ProductModifierGroup | ReturnType<typeof validationFailure> {
  if (!isRecord(value)) return validationFailure('modifierGroups', path, 'invalid_type', `Expected object, received ${receivedType(value)}`);
  const strict = assertStrictKeys('modifierGroups', value, groupKeys, path);
  if (strict) return strict;
  for (const key of groupKeys) if (!(key in value)) return validationFailure('modifierGroups', [...path, key], 'invalid_type', 'Required');
  if (typeof value.groupRef !== 'string' || value.groupRef.length < 1) return validationFailure('modifierGroups', [...path, 'groupRef'], 'invalid_type', 'Expected string, received ' + receivedType(value.groupRef));
  if (typeof value.required !== 'boolean') return validationFailure('modifierGroups', [...path, 'required'], 'invalid_type', `Expected boolean, received ${receivedType(value.required)}`);
  const min = parseInteger(value.min, [...path, 'min']);
  if (typeof min !== 'number') return min;
  const max = parseInteger(value.max, [...path, 'max']);
  if (typeof max !== 'number') return max;
  const freeQuantity = parseInteger(value.freeQuantity, [...path, 'freeQuantity']);
  if (typeof freeQuantity !== 'number') return freeQuantity;
  const rank = parseInteger(value.rank, [...path, 'rank']);
  if (typeof rank !== 'number') return rank;
  if (!isRecord(value.overrides)) return validationFailure('modifierGroups', [...path, 'overrides'], 'invalid_type', `Expected object, received ${receivedType(value.overrides)}`);
  const overrides: Record<string, ModifierOverride> = {};
  for (const [modifierRef, override] of Object.entries(value.overrides)) {
    const parsed = parseOverride(override, [...path, 'overrides', modifierRef]);
    if (isValidationFailure(parsed)) return parsed;
    overrides[modifierRef] = parsed as ModifierOverride;
  }
  return { groupRef: value.groupRef, required: value.required, min, max, freeQuantity, rank, overrides };
}

/** Browser-safe structural validation. Database reference checks stay in server/. */
export function validateModifierGroups(raw: unknown): ModifierGroupsValidation {
  if (raw === null || raw === undefined) return { valid: true, value: [] };
  if (!Array.isArray(raw)) return validationFailure('modifierGroups', [], 'invalid_type', `Expected array, received ${receivedType(raw)}`);
  if (raw.length > 50) return validationFailure('modifierGroups', [], 'too_big', 'Array must contain at most 50 element(s)');
  const value: ProductModifierGroup[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < raw.length; index += 1) {
    const group = parseGroup(raw[index], [index]);
    if (isValidationFailure(group)) return group;
    const parsed = group as ProductModifierGroup;
    if (seen.has(parsed.groupRef)) return validationFailure('modifierGroups', [index, 'groupRef'], 'custom', `${index}.groupRef is duplicated`, { index });
    seen.add(parsed.groupRef);
    if (parsed.max > 0 && parsed.min > parsed.max) return validationFailure('modifierGroups', [index], 'custom', `${index} has min > max`, { index });
    value.push(parsed);
  }
  return { valid: true, value };
}
