import { z } from '@strapi/utils';

/**
 * `modifierGroups` on catalog-product — attaches library modifier groups to a dish with
 * per-product overrides (contracts §20.1, TastyIgniter attach model). `groupRef` and every
 * `overrides` key are Strapi `documentId`s of `catalog-modifier-group` / `catalog-modifier`
 * rows: stable, unambiguous, and what the Content Manager pickers store.
 * `max: 0` means "no upper bound" (min must then be 0 as well is NOT required — min ≤ max is
 * skipped when max is 0).
 */

export const modifierOverrideSchema = z
  .object({
    priceDelta: z.number().int().optional(),
    isDefault: z.boolean().optional(),
    hidden: z.boolean().optional(),
  })
  .strict();

export const productModifierGroupSchema = z
  .object({
    groupRef: z.string().min(1),
    required: z.boolean(),
    min: z.number().int().min(0),
    max: z.number().int().min(0),
    freeQuantity: z.number().int().min(0),
    rank: z.number().int().min(0),
    overrides: z.record(z.string(), modifierOverrideSchema).default({}),
  })
  .strict();

export const modifierGroupsSchema = z.array(productModifierGroupSchema).max(50);

export type ProductModifierGroup = z.infer<typeof productModifierGroupSchema>;

export type ModifierGroupsValidation =
  | { valid: true; value: ProductModifierGroup[] }
  | { valid: false; message: string; details: Record<string, unknown> };

/** Library snapshot used for reference checks — collected by the caller from the database. */
export type ModifierLibrary = {
  /** documentIds of existing `catalog-modifier-group` rows. */
  groupDocumentIds: Set<string>;
  /** documentIds of existing `catalog-modifier` rows, keyed by their group's documentId. */
  modifierDocumentIdsByGroup: Map<string, Set<string>>;
};

/** Structural validation — shape, bounds, duplicates, no reference lookups. */
export function validateModifierGroups(raw: unknown): ModifierGroupsValidation {
  if (raw === null || raw === undefined) {
    return { valid: true, value: [] };
  }
  const parsed = modifierGroupsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      valid: false,
      message: `modifierGroups${issue.path.length > 0 ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
      details: { field: 'modifierGroups', path: issue.path },
    };
  }
  const value = parsed.data;
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const group = value[index];
    if (seen.has(group.groupRef)) {
      return {
        valid: false,
        message: `modifierGroups.${index}.groupRef is duplicated`,
        details: { field: 'modifierGroups', index },
      };
    }
    seen.add(group.groupRef);
    if (group.max > 0 && group.min > group.max) {
      return {
        valid: false,
        message: `modifierGroups.${index} has min > max`,
        details: { field: 'modifierGroups', index },
      };
    }
  }
  return { valid: true, value };
}

/**
 * Reference validation — every `groupRef` must exist and every override key must be a
 * modifier that belongs to that group. Pure: the library snapshot is passed in.
 */
export function validateModifierGroupRefs(
  value: ProductModifierGroup[],
  library: ModifierLibrary,
): ModifierGroupsValidation {
  for (let index = 0; index < value.length; index += 1) {
    const group = value[index];
    if (!library.groupDocumentIds.has(group.groupRef)) {
      return {
        valid: false,
        message: `modifierGroups.${index}.groupRef does not reference an existing modifier group`,
        details: { field: 'modifierGroups', index, groupRef: group.groupRef },
      };
    }
    const members = library.modifierDocumentIdsByGroup.get(group.groupRef) ?? new Set<string>();
    for (const modifierRef of Object.keys(group.overrides)) {
      if (!members.has(modifierRef)) {
        return {
          valid: false,
          message: `modifierGroups.${index}.overrides references a modifier outside the group`,
          details: { field: 'modifierGroups', index, groupRef: group.groupRef, modifierRef },
        };
      }
    }
  }
  return { valid: true, value };
}
