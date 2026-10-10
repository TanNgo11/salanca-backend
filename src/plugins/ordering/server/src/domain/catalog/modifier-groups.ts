import {
  type ModifierGroupsValidation,
  type ModifierLibrary,
  type ProductModifierGroup,
} from '../../../../shared/catalog/modifier-groups';

export { validateModifierGroups } from '../../../../shared/catalog/modifier-groups';
export type {
  ModifierGroupsValidation,
  ModifierLibrary,
  ModifierOverride,
  ProductModifierGroup,
} from '../../../../shared/catalog/modifier-groups';

/** Reference validation remains server-only because it reads the catalog library from the DB. */
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
        code: 'custom',
        path: [index, 'groupRef'],
        details: { field: 'modifierGroups', index, groupRef: group.groupRef },
      };
    }
    const members = library.modifierDocumentIdsByGroup.get(group.groupRef) ?? new Set<string>();
    for (const modifierRef of Object.keys(group.overrides)) {
      if (!members.has(modifierRef)) {
        return {
          valid: false,
          message: `modifierGroups.${index}.overrides references a modifier outside the group`,
          code: 'custom',
          path: [index, 'overrides', modifierRef],
          details: { field: 'modifierGroups', index, groupRef: group.groupRef, modifierRef },
        };
      }
    }
  }
  return { valid: true, value };
}
