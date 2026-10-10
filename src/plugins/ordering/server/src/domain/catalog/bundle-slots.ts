import {
  type BundleSlot,
  type BundleSlotsValidation,
} from '../../../../shared/catalog/bundle-slots';

export { validateBundleSlots } from '../../../../shared/catalog/bundle-slots';
export type { BundleSlot, BundleSlotItem, BundleSlotsValidation } from '../../../../shared/catalog/bundle-slots';

/** Reference validation remains server-only because it reads the catalog library from the DB. */
export function validateBundleSlotRefs(
  value: BundleSlot[],
  variantDocumentIds: Set<string>,
): BundleSlotsValidation {
  for (let index = 0; index < value.length; index += 1) {
    for (let itemIndex = 0; itemIndex < value[index].items.length; itemIndex += 1) {
      const item = value[index].items[itemIndex];
      if (!variantDocumentIds.has(item.variantRef)) {
        return {
          valid: false,
          message: `bundleSlots.${index}.items.${itemIndex}.variantRef does not reference an existing variant`,
          code: 'custom',
          path: [index, 'items', itemIndex, 'variantRef'],
          details: { field: 'bundleSlots', index, itemIndex, variantRef: item.variantRef },
        };
      }
    }
  }
  return { valid: true, value };
}
