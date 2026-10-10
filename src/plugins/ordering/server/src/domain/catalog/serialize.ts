/**
 * Public catalog serializers (contracts §20.2, plan step 7): shrink Sellable/category records
 * to the storefront allowlist — no db internals (`rank`, `metadata.availabilityInput`), no raw
 * relations. Field names follow the approved mockup (`slug`, `name`, `variants`, `options`…).
 */

import type { JsonObject, Sellable } from '../../contracts';

const obj = (v: unknown): JsonObject =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as JsonObject) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? (v as unknown[]) : []);

interface CategoryRowInput {
  ref?: unknown;
  slug?: unknown;
  title?: unknown;
  description?: unknown;
  parentRef?: unknown;
  isActive?: unknown;
  isInternal?: unknown;
}

const serializeCategory = (row: CategoryRowInput): JsonObject => ({
  id: row.ref,
  slug: row.slug ?? null,
  name: row.title,
  description: row.description ?? null,
  parentId: row.parentRef ?? null,
});

/**
 * Categories go out as a tree (rows are already rank-sorted by the adapter). Inactive or
 * `isInternal` categories — and their whole subtree — never leave the building.
 */
export const serializeCategoryTree = (rows: CategoryRowInput[]): JsonObject[] => {
  const byRef = new Map(rows.map((row) => [row.ref, row]));
  const hidden = (row: CategoryRowInput): boolean => {
    // A hidden ancestor hides the whole subtree; a dangling parent ref acts like a root.
    let cursor: CategoryRowInput | undefined = row;
    const seen = new Set<unknown>();
    while (cursor && !seen.has(cursor.ref)) {
      seen.add(cursor.ref);
      if (cursor.isActive === false || cursor.isInternal === true) return true;
      cursor = byRef.get(cursor.parentRef);
    }
    return false;
  };
  const visible = rows.filter((row) => !hidden(row));
  const nodes = new Map<unknown, { category: JsonObject; children: JsonObject[] }>();
  for (const row of visible) nodes.set(row.ref, { category: serializeCategory(row), children: [] });
  const roots: JsonObject[] = [];
  for (const row of visible) {
    const node = nodes.get(row.ref);
    if (!node) continue;
    const entry = { ...node.category, children: node.children };
    const parent = nodes.get(row.parentRef);
    if (parent) parent.children.push(entry);
    else roots.push(entry);
  }
  return roots;
};

interface AvailabilityExtra {
  reasons?: unknown;
  resumesAt?: unknown;
}

const serializeVariants = (sellable: Sellable): JsonObject[] => {
  const catalog = obj(sellable.metadata?.catalog);
  return arr(catalog.variants).map((v) => {
    const row = obj(v);
    return {
      id: row.ref,
      name: row.title ?? row.ref,
      price: row.price ?? null,
      ...(row.isDefault === true ? { default: true } : {}),
      ...(row.available === false ? { available: false } : {}),
    };
  });
};

const serializeOptionGroups = (sellable: Sellable): JsonObject[] =>
  (sellable.options ?? []).map((group) => ({
    id: group.uid,
    group: group.name,
    required: group.required,
    min: group.minQuantity,
    max: group.maxQuantity >= Number.MAX_SAFE_INTEGER ? null : group.maxQuantity,
    choices: group.options.map((option) => ({
      id: option.uid,
      name: option.name,
      price: option.unitPriceDelta.amount,
      ...(group.defaultOptionUids.includes(option.uid) ? { default: true } : {}),
      ...(option.isActive === false ? { available: false } : {}),
    })),
  }));

/**
 * One product shape serves the list and the detail — the mockup already shows the full block
 * inside the list item. `availability` extras appear only when the product can't be bought.
 */
export const serializeProduct = (sellable: Sellable): JsonObject => {
  const catalog = obj(sellable.metadata?.catalog);
  const availability = obj(catalog.availability) as AvailabilityExtra;
  return {
    id: sellable.ref.uid,
    slug: catalog.slug ?? null,
    name: sellable.title,
    description: sellable.description ?? null,
    image: sellable.imageUrl ?? null,
    price: sellable.listPrice.amount,
    currency: sellable.listPrice.currency,
    ...(sellable.compareAtListPrice
      ? { compareAtPrice: sellable.compareAtListPrice.amount }
      : {}),
    categories: sellable.categories.map((category) => category.title),
    variants: serializeVariants(sellable),
    options: serializeOptionGroups(sellable),
    available: sellable.purchasable === true,
    ...(sellable.purchasable
      ? {}
      : {
          reasons: arr(availability.reasons),
          ...(availability.resumesAt ? { resumesAt: availability.resumesAt } : {}),
        }),
    ...(sellable.minQuantity !== undefined ? { minQuantity: sellable.minQuantity } : {}),
    fulfillment: sellable.fulfillmentKinds,
  };
};
