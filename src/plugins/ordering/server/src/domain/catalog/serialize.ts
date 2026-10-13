/**
 * Public catalog serializers (contracts §20.2, plan step 7): shrink Sellable/category records
 * to the storefront allowlist — no db internals (`rank`, `metadata.availabilityInput`), no raw
 * relations. Field names follow the approved mockup (`slug`, `name`, `variants`, `options`…).
 */

import type { JsonObject, Sellable } from '../../contracts';
import { dailyStockKey, modifierDocumentId } from '../daily-stock-lines';

/** Remaining portions for the catalog date. Absent keys are unlimited. */
export type DailyStockView = {
  date: string;
  remainingByKey: ReadonlyMap<string, number>;
};

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

const dailyOf = (
  daily: DailyStockView | undefined,
  entityType: string,
  entityDocumentId: string,
): { remaining: number; date: string } | undefined => {
  if (!daily || typeof entityDocumentId !== 'string' || entityDocumentId.length === 0) return undefined;
  const remaining = daily.remainingByKey.get(dailyStockKey(entityType, entityDocumentId));
  if (remaining === undefined) return undefined;
  return { remaining, date: daily.date };
};

const serializeVariants = (sellable: Sellable, daily?: DailyStockView): JsonObject[] => {
  const catalog = obj(sellable.metadata?.catalog);
  return arr(catalog.variants).map((v) => {
    const row = obj(v);
    const portion = dailyOf(daily, 'variant', typeof row.ref === 'string' ? row.ref : '');
    const soldOut = portion?.remaining === 0;
    return {
      id: row.ref,
      name: row.title ?? row.ref,
      price: row.price ?? null,
      ...(row.isDefault === true ? { default: true } : {}),
      ...(row.available === false || soldOut ? { available: false } : {}),
      ...(portion ? { dailyLimit: portion } : {}),
    };
  });
};

const serializeOptionGroups = (sellable: Sellable, daily?: DailyStockView): JsonObject[] =>
  (sellable.options ?? []).map((group) => ({
    id: group.uid,
    group: group.name,
    required: group.required,
    min: group.minQuantity,
    max: group.maxQuantity >= Number.MAX_SAFE_INTEGER ? null : group.maxQuantity,
    choices: group.options.map((option) => {
      const portion = dailyOf(daily, 'modifier', modifierDocumentId(option.uid));
      const soldOut = portion?.remaining === 0;
      return {
        id: option.uid,
        name: option.name,
        price: option.unitPriceDelta.amount,
        ...(group.defaultOptionUids.includes(option.uid) ? { default: true } : {}),
        ...(option.isActive === false || soldOut ? { available: false } : {}),
        ...(portion ? { dailyLimit: portion } : {}),
      };
    }),
  }));

/**
 * One product shape serves the list and the detail — the mockup already shows the full block
 * inside the list item. `availability` extras appear only when the product can't be bought.
 */
export const serializeProduct = (sellable: Sellable, daily?: DailyStockView): JsonObject => {
  const catalog = obj(sellable.metadata?.catalog);
  const availability = obj(catalog.availability) as AvailabilityExtra;
  const portion = dailyOf(daily, 'product', sellable.ref.sourceDocumentId || sellable.ref.uid);
  const soldOut = portion?.remaining === 0;
  const purchasable = sellable.purchasable === true;
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
    variants: serializeVariants(sellable, daily),
    options: serializeOptionGroups(sellable, daily),
    available: purchasable && !soldOut,
    ...(portion ? { dailyLimit: portion } : {}),
    ...(soldOut ? { unavailableReason: 'sold-out-today' } : {}),
    ...(purchasable
      ? {}
      : {
          reasons: arr(availability.reasons),
          ...(availability.resumesAt ? { resumesAt: availability.resumesAt } : {}),
        }),
    ...(sellable.minQuantity !== undefined ? { minQuantity: sellable.minQuantity } : {}),
    fulfillment: sellable.fulfillmentKinds,
  };
};
