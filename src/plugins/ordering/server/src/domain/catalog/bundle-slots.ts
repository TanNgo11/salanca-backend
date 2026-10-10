import { z } from '@strapi/utils';

/**
 * `bundleSlots` on catalog-product — choice groups inside a combo (contracts §20.1, Bagisto
 * bundle model). `variantRef` is a `catalog-variant` documentId. A fixed combo is a product
 * whose every slot holds exactly one item; a required slot whose items are all temporarily
 * unavailable makes the whole combo unavailable (availability domain).
 */

export const bundleSlotItemSchema = z
  .object({
    variantRef: z.string().min(1),
    quantity: z.number().int().min(1),
    isDefault: z.boolean(),
    priceDelta: z.number().int(),
  })
  .strict();

export const bundleSlotSchema = z
  .object({
    key: z.string().min(1).max(50),
    name: z.record(z.string(), z.string()).default({}),
    selection: z.enum(['single', 'multiple']),
    required: z.boolean(),
    min: z.number().int().min(0),
    max: z.number().int().min(0),
    rank: z.number().int().min(0),
    items: z.array(bundleSlotItemSchema).max(100),
  })
  .strict();

export const bundleSlotsSchema = z.array(bundleSlotSchema).max(20);

export type BundleSlotItem = z.infer<typeof bundleSlotItemSchema>;
export type BundleSlot = z.infer<typeof bundleSlotSchema>;

export type BundleSlotsValidation =
  | { valid: true; value: BundleSlot[] }
  | { valid: false; message: string; details: Record<string, unknown> };

/** Structural validation — shape, bounds, duplicates, selection semantics. */
export function validateBundleSlots(raw: unknown): BundleSlotsValidation {
  if (raw === null || raw === undefined) {
    return { valid: true, value: [] };
  }
  const parsed = bundleSlotsSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      valid: false,
      message: `bundleSlots${issue.path.length > 0 ? `.${issue.path.join('.')}` : ''}: ${issue.message}`,
      details: { field: 'bundleSlots', path: issue.path },
    };
  }
  const value = parsed.data;
  const seen = new Set<string>();
  for (let index = 0; index < value.length; index += 1) {
    const slot = value[index];
    if (seen.has(slot.key)) {
      return {
        valid: false,
        message: `bundleSlots.${index}.key is duplicated`,
        details: { field: 'bundleSlots', index },
      };
    }
    seen.add(slot.key);
    if (slot.selection === 'single' && slot.max > 1) {
      return {
        valid: false,
        message: `bundleSlots.${index} is a single-choice slot but allows max ${slot.max}`,
        details: { field: 'bundleSlots', index },
      };
    }
    if (slot.max > 0 && slot.min > slot.max) {
      return {
        valid: false,
        message: `bundleSlots.${index} has min > max`,
        details: { field: 'bundleSlots', index },
      };
    }
    if (slot.required && slot.min === 0) {
      return {
        valid: false,
        message: `bundleSlots.${index} is required but allows choosing nothing (min 0)`,
        details: { field: 'bundleSlots', index },
      };
    }
  }
  return { valid: true, value };
}

/** Reference validation — every `variantRef` must be an existing `catalog-variant`. */
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
          details: { field: 'bundleSlots', index, itemIndex, variantRef: item.variantRef },
        };
      }
    }
  }
  return { valid: true, value };
}
