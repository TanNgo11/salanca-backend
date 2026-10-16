import type { Core } from '@strapi/strapi';

import type {
  AdapterContext,
  AvailabilityResult,
  CatalogAdapter,
  JsonObject,
  Locale,
  Sellable,
  SellableRef,
} from '../../contracts';
import {
  type AvailabilityInput,
  evaluateAvailability,
  type LocationState,
  type SellingWindow,
} from '../../domain/catalog/availability';
import type { BundleSlot } from '../../domain/catalog/bundle-slots';
import { OrderingError } from '../../domain/errors';
import { resolveLocalizedText } from '../../domain/catalog/localized-text';
import {
  normalizeKitchenStation,
  sanitizeAllergens,
  sanitizeDietaryTags,
} from '../../domain/catalog/allergens';
import type { ProductModifierGroup } from '../../domain/catalog/modifier-groups';
import {
  applyAdjustLists,
  type AdjustList,
  type CatalogPriceRow,
  type PriceContext,
  type VariantPriceContext,
  selectCatalogPrice,
} from '../../domain/catalog/price-selection';
import { amountFromDb, toMoney, DEFAULT_CURRENCY, type Money } from '../../domain/money';
import type catalogSlugFactory from '../../services/catalog-slug';

const PRODUCT = 'plugin::ordering.catalog-product';
const CATEGORY = 'plugin::ordering.catalog-category';
const VARIANT = 'plugin::ordering.catalog-variant';
const GROUP = 'plugin::ordering.catalog-modifier-group';
const MODIFIER = 'plugin::ordering.catalog-modifier';
const WINDOW = 'plugin::ordering.catalog-availability-window';
const STATE = 'plugin::ordering.catalog-location-state';
const BRANCH = 'plugin::ordering.branch';

/** Option/identity uid namespaces — modifier options and bundle items never collide. */
export const uidOf = {
  group: (ref: string) => `mg:${ref}`,
  option: (ref: string) => `mod:${ref}`,
  slot: (key: string) => `slot:${key}`,
  item: (ref: string) => `item:${ref}`,
};
export const unprefix = (uid: string, prefix: string): string =>
  uid.startsWith(`${prefix}:`) ? uid.slice(prefix.length + 1) : uid;

type DbRow = { id: number; documentId: string } & Record<string, unknown>;

type CategoryRow = DbRow & {
  name?: unknown;
  description?: unknown;
  rank?: number;
  isActive?: boolean;
  isInternal?: boolean;
  kitchenStation?: unknown;
  parent?: { documentId?: string } | null;
};

type VariantRow = DbRow & {
  sku?: string;
  name?: unknown;
  attributes?: JsonObject;
  isDefault?: boolean;
  rank?: number;
  inventoryRef?: string;
  product?: { documentId?: string; status?: string; sellOnline?: boolean } | null;
  prices?: CatalogPriceRow[];
};

type ModifierRow = DbRow & {
  name?: unknown;
  priceDelta?: number | string;
  rank?: number;
  group?: { documentId?: string } | null;
};

type GroupRow = DbRow & { selectionType?: string; name?: unknown };

type ProductRow = DbRow & {
  productType?: string;
  name?: unknown;
  description?: unknown;
  slug?: unknown;
  image?: { url?: string } | null;
  status?: string;
  sellOnline?: boolean;
  minQuantity?: number;
  fulfillmentKinds?: unknown;
  taxGroupRef?: string;
  modifierGroups?: unknown;
  bundleSlots?: unknown;
  allergens?: unknown;
  dietaryTags?: unknown;
  rank?: number;
  variants?: VariantRow[];
  categories?: { documentId?: string }[];
  availabilityWindows?: DbRow[];
};

export type NormalizedSlotItem = {
  optionUid: string;
  variantRef: string;
  productRef: string;
  title?: string;
  sku?: string;
  quantity: number;
  isDefault: boolean;
  priceDelta: number;
};

export type NormalizedBundleSlot = {
  key: string;
  /** The OptionGroup uid this slot occupies — lets snapshots match picks without uid rules. */
  optionGroupUid: string;
  name?: Record<string, string>;
  selection: 'single' | 'multiple';
  required: boolean;
  min: number;
  max: number;
  items: NormalizedSlotItem[];
};

const asArray = <T>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);

/** Local wall-clock Date for a branch timezone — availability windows are local-time. */
const branchLocal = (isoNow: string, timezone?: string): Date => {
  if (!timezone) return new Date(isoNow);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoNow));
  const take = (type: string) => parts.find((part) => part.type === type)?.value ?? '0';
  return new Date(
    `${take('year')}-${take('month')}-${take('day')}T${take('hour')}:${take('minute')}:${take('second')}`,
  );
};

/** Whether a location-state row blocks selling right now. */
const stateBlocks = (state: LocationState | null, nowIso: string): boolean => {
  if (!state) return false;
  if (state.outOfStockUntil) {
    return new Date(state.outOfStockUntil).getTime() > Date.parse(nowIso);
  }
  return state.selling === false;
};

/** Request-scoped loaders — batches every secondary lookup so a page costs a handful of queries. */
const createLoader = (strapi: Core.Strapi, defaultLocale: string) => {
  let categoriesIndex: Map<string, CategoryRow> | null = null;
  const groupsByRef = new Map<string, GroupRow>();
  const modifiersByRef = new Map<string, ModifierRow>();
  const variantsByRef = new Map<string, VariantRow>();
  const states = new Map<string, LocationState>();
  const slugRows = new Map<string, Map<string, string>>();
  const branchTimezones = new Map<string, string | undefined>();
  let modifiersLoaded = false;
  let adjustLists: AdjustList[] | null = null;

  const allCategories = async (): Promise<Map<string, CategoryRow>> => {
    if (!categoriesIndex) {
      const rows = (await strapi.db.query(CATEGORY).findMany({
        populate: { parent: { select: ['documentId'] } },
      })) as CategoryRow[];
      categoriesIndex = new Map(rows.map((row) => [row.documentId, row]));
    }
    return categoriesIndex;
  };

  /** Ancestor chain of a category (nearest parent first) — short trees, cycle-safe. */
  const ancestorsOf = async (documentId: string): Promise<CategoryRow[]> => {
    const index = await allCategories();
    const chain: CategoryRow[] = [];
    const seen = new Set<string>([documentId]);
    let cursor = index.get(documentId)?.parent?.documentId;
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor);
      const row = index.get(cursor);
      if (!row) break;
      chain.push(row);
      cursor = row.parent?.documentId;
    }
    return chain;
  };

  /** Loads every modifier once — the library is small and products share it across a page. */
  const collectGroups = async (refs: Iterable<string>) => {
    const missing = [...refs].filter((ref) => !groupsByRef.has(ref));
    if (missing.length > 0) {
      const rows = (await strapi.db
        .query(GROUP)
        .findMany({ where: { documentId: { $in: missing } } })) as GroupRow[];
      for (const row of rows) groupsByRef.set(row.documentId, row);
    }
    if (missing.length > 0 && !modifiersLoaded) {
      modifiersLoaded = true;
      const mods = (await strapi.db.query(MODIFIER).findMany({
        populate: { group: { select: ['documentId'] } },
        orderBy: { rank: 'asc' },
      })) as ModifierRow[];
      for (const row of mods) modifiersByRef.set(row.documentId, row);
    }
  };

  const collectVariants = async (refs: Iterable<string>) => {
    const missing = [...refs].filter((ref) => !variantsByRef.has(ref));
    if (missing.length === 0) return;
    const rows = (await strapi.db.query(VARIANT).findMany({
      where: { documentId: { $in: missing } },
      populate: { product: { select: ['documentId', 'status', 'sellOnline'] } },
    })) as VariantRow[];
    for (const row of rows) variantsByRef.set(row.documentId, row);
  };

  /** Loads `catalog-location-state` rows for refs at this location; absent = sellable. */
  const collectStates = async (locationRef: string | undefined, refs: Iterable<string>) => {
    if (!locationRef) return;
    const missing = [...refs].filter((ref) => !states.has(ref));
    if (missing.length === 0) return;
    const rows = (await strapi.db.query(STATE).findMany({
      where: { locationRef, entityDocumentId: { $in: missing } },
    })) as (LocationState & { entityDocumentId: string })[];
    for (const ref of missing) states.set(ref, {});
    for (const row of rows) {
      states.set(row.entityDocumentId, {
        selling: row.selling,
        outOfStockUntil: row.outOfStockUntil,
      });
    }
  };

  const stateOf = (ref: string): LocationState | null => states.get(ref) ?? null;

  /** Loads `catalog-slug` rows so serializers can emit the public slug per locale. */
  const collectSlugs = async (entityType: string, refs: Iterable<string>) => {
    const missing = [...refs].filter((ref) => !slugRows.has(ref));
    if (missing.length === 0) return;
    const rows = (await strapi.db.query('plugin::ordering.catalog-slug').findMany({
      where: { entityType, entityDocumentId: { $in: missing } },
    })) as { entityDocumentId: string; locale: string; slug: string }[];
    for (const ref of missing) slugRows.set(ref, new Map());
    for (const row of rows) slugRows.get(row.entityDocumentId)?.set(row.locale, row.slug);
  };

  const slugOf = (ref: string, locale: string): string | undefined =>
    slugRows.get(ref)?.get(locale) ?? slugRows.get(ref)?.get(defaultLocale);

  const branchTimezone = async (locationRef?: string): Promise<string | undefined> => {
    if (!locationRef) return undefined;
    if (!branchTimezones.has(locationRef)) {
      const branch = (await strapi.db
        .query(BRANCH)
        .findOne({ where: { code: locationRef } })) as { timezone?: string } | null;
      branchTimezones.set(locationRef, branch?.timezone);
    }
    return branchTimezones.get(locationRef);
  };

  /** Product windows + every window on the product's categories and their ancestors. */
  const windowsFor = async (product: ProductRow): Promise<SellingWindow[]> => {
    const windows = asArray<DbRow & SellingWindow>(product.availabilityWindows).slice();
    const categoryIds = new Set<number>();
    for (const ref of asArray<{ documentId?: string }>(product.categories)) {
      if (!ref.documentId) continue;
      const index = await allCategories();
      const self = index.get(ref.documentId);
      const chain = self ? [self, ...(await ancestorsOf(ref.documentId))] : [];
      for (const row of chain) categoryIds.add(row.id);
    }
    if (categoryIds.size > 0) {
      const rows = (await strapi.db.query(WINDOW).findMany({
        where: { category: { id: { $in: [...categoryIds] } } },
      })) as (DbRow & SellingWindow)[];
      windows.push(...rows);
    }
    return windows;
  };

  const loadAdjustLists = async (): Promise<AdjustList[]> => {
    if (!adjustLists) {
      const service = strapi.plugin('ordering').service('price-list') as {
        activeAdjustLists(locale?: string): Promise<AdjustList[]>;
      };
      adjustLists = await service.activeAdjustLists();
    }
    return adjustLists;
  };

  return {
    defaultLocale,
    allCategories,
    loadAdjustLists,
    ancestorsOf,
    collectGroups,
    collectVariants,
    collectStates,
    collectSlugs,
    groupsByRef,
    modifiersByRef,
    variantsByRef,
    stateOf,
    slugOf,
    branchTimezone,
    windowsFor,
  };
};

type Loader = ReturnType<typeof createLoader>;

/** Builds the Sellable for one product row; every secondary lookup rides the request loader. */
const toSellable = async (
  strapi: Core.Strapi,
  loader: Loader,
  product: ProductRow,
  ctx: AdapterContext,
  locale: Locale,
): Promise<Sellable> => {
  const pick = (value: unknown) => resolveLocalizedText(value, locale, loader.defaultLocale);
  const categories = await loader.allCategories();

  // Variants: default first, then rank — the first is the headline variant.
  const variants = [...asArray<VariantRow>(product.variants)].sort(
    (a, b) =>
      Number(b.isDefault === true) - Number(a.isDefault === true) || (a.rank ?? 0) - (b.rank ?? 0),
  );
  const variant = variants[0];

  // Category snapshots: every direct category, path rendered root → leaf.
  const categorySnapshots: Sellable['categories'] = [];
  let categoryActive = true;
  // O12: KDS station — own category first, then each ancestor nearest-first; the first
  // non-empty station wins across all direct categories in link order.
  let kitchenStation: string | null = null;
  for (const ref of asArray<{ documentId?: string }>(product.categories)) {
    if (!ref.documentId) continue;
    const category = categories.get(ref.documentId);
    if (!category) continue;
    const chain = [...(await loader.ancestorsOf(ref.documentId)).reverse(), category];
    if (chain.some((row) => row.isActive === false)) categoryActive = false;
    categorySnapshots.push({
      ref: category.documentId,
      title: pick(category.name) ?? category.documentId,
      path: chain.map((row) => row.documentId),
    });
    if (!kitchenStation) {
      for (const row of [...chain].reverse()) {
        const station = normalizeKitchenStation(row.kitchenStation);
        if (station) {
          kitchenStation = station;
          break;
        }
      }
    }
  }

  // Modifier library needed by the attach records.
  const attachGroups = asArray<ProductModifierGroup>(product.modifierGroups);
  await loader.collectGroups(attachGroups.map((group) => group.groupRef));
  const modifierRefs = new Set<string>();
  for (const attach of attachGroups) {
    for (const [ref, mod] of loader.modifiersByRef) {
      if (mod.group?.documentId === attach.groupRef) modifierRefs.add(ref);
    }
  }
  await loader.collectStates(ctx.locationRef, [
    product.documentId,
    ...variants.map((row) => row.documentId),
    ...modifierRefs,
  ]);

  const options: Sellable['options'] = [];
  for (const attach of [...attachGroups].sort((a, b) => a.rank - b.rank)) {
    const group = loader.groupsByRef.get(attach.groupRef);
    if (!group) continue;
    const members = [...loader.modifiersByRef.values()]
      .filter((mod) => mod.group?.documentId === attach.groupRef)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
    const overrideFor = (ref: string) => attach.overrides?.[ref] ?? {};
    const single = group.selectionType === 'single';
    options.push({
      uid: uidOf.group(attach.groupRef),
      name: pick(group.name) ?? attach.groupRef,
      required: attach.required,
      defaultOptionUids: members
        .filter((mod) => overrideFor(mod.documentId).isDefault === true)
        .map((mod) => uidOf.option(mod.documentId)),
      minQuantity: attach.min,
      maxQuantity:
        attach.max > 0 ? (single ? Math.min(attach.max, 1) : attach.max) : single ? 1 : Number.MAX_SAFE_INTEGER,
      stepQuantity: 1,
      freeQuantity: attach.freeQuantity,
      options: members
        .filter((mod) => overrideFor(mod.documentId).hidden !== true)
        .map((mod) => {
          const override = overrideFor(mod.documentId);
          return {
            uid: uidOf.option(mod.documentId),
            name: pick(mod.name) ?? mod.documentId,
            unitPriceDelta: toMoney(
              override.priceDelta ?? amountFromDb(mod.priceDelta ?? 0),
              DEFAULT_CURRENCY,
            ),
            isActive: !stateBlocks(loader.stateOf(mod.documentId), ctx.now),
          };
        }),
    });
  }

  // Bundle slots → extra option groups + normalized metadata for components snapshots.
  const slots = asArray<BundleSlot>(product.bundleSlots);
  const variantRefs = slots.flatMap((slot) => slot.items.map((item) => item.variantRef));
  await loader.collectVariants(variantRefs);
  await loader.collectStates(ctx.locationRef, variantRefs);

  const timezone = ctx.timezone ?? (await loader.branchTimezone(ctx.locationRef));
  const nowLocal = branchLocal(ctx.now, timezone);
  const adjustLists = await loader.loadAdjustLists();
  const priceCtx: PriceContext = {
    at: new Date(ctx.now),
    locationRef: ctx.locationRef,
    channel: ctx.channel,
    customerGroups: ctx.customerGroups,
    timezone,
  };
  const priceOf = (row: VariantRow): ReturnType<typeof selectCatalogPrice> => {
    if (!row.prices?.length) return null;
    const base = selectCatalogPrice(row.prices, priceCtx);
    if (!base) return null;
    const variantContext: VariantPriceContext = {
      variantRef: row.documentId,
      productRef: product.documentId,
      categoryRefs: categorySnapshots.map((category) => category.ref),
    };
    return applyAdjustLists(base, adjustLists, variantContext, priceCtx);
  };
  const selectedPrice = variant ? priceOf(variant) : null;
  const componentAvailable = (variantRef: string): boolean => {
    const row = loader.variantsByRef.get(variantRef);
    if (!row) return false;
    const owner = row.product;
    if (owner && (owner.status !== 'active' || owner.sellOnline === false)) return false;
    return !stateBlocks(loader.stateOf(variantRef), ctx.now)
      && !(owner?.documentId && stateBlocks(loader.stateOf(owner.documentId), ctx.now));
  };

  const normalizedSlots: NormalizedBundleSlot[] = [];
  for (const slot of [...slots].sort((a, b) => a.rank - b.rank)) {
    const items: NormalizedSlotItem[] = slot.items.map((item) => {
      const row = loader.variantsByRef.get(item.variantRef);
      return {
        optionUid: uidOf.item(item.variantRef),
        variantRef: item.variantRef,
        productRef: row?.product?.documentId ?? '',
        title: pick(row?.name),
        sku: row?.sku,
        quantity: item.quantity,
        isDefault: item.isDefault,
        priceDelta: item.priceDelta,
      };
    });
    normalizedSlots.push({ ...slot, optionGroupUid: uidOf.slot(slot.key), items });
    options.push({
      uid: uidOf.slot(slot.key),
      name: resolveLocalizedText(slot.name, locale, loader.defaultLocale) ?? slot.key,
      required: slot.required,
      defaultOptionUids: items.filter((item) => item.isDefault).map((item) => item.optionUid),
      minQuantity: slot.min,
      maxQuantity:
        slot.selection === 'single' ? 1 : slot.max > 0 ? slot.max : Number.MAX_SAFE_INTEGER,
      stepQuantity: 1,
      freeQuantity: 0,
      options: items.map((item) => ({
        uid: item.optionUid,
        name: item.title ?? item.variantRef,
        unitPriceDelta: toMoney(item.priceDelta, DEFAULT_CURRENCY),
        isActive: componentAvailable(item.variantRef),
      })),
    });
  }

  // Product availability: own windows + ancestor category windows on the branch-local clock,
  // location-state, and every required slot still having a sellable choice.
  const requiredOk = normalizedSlots
    .filter((slot) => slot.required)
    .every((slot) => slot.items.some((item) => componentAvailable(item.variantRef)));
  const windows = await loader.windowsFor(product);
  const availabilityInput: AvailabilityInput = {
    status: product.status,
    sellOnline: product.sellOnline ?? true,
    locationState: loader.stateOf(product.documentId),
    windows,
    timezone,
    allRequiredComponentsAvailable: requiredOk,
    categoryActive,
  };
  const verdict = evaluateAvailability({ ...availabilityInput, nowLocal, now: new Date(ctx.now) });

  // Public-catalog extras the storefront serializer needs (Step 7): slug for pretty URLs and
  // every variant with its context-selected price — the Sellable itself keeps only the first.
  await loader.collectSlugs('catalog-product', [product.documentId]);
  const catalogExtras = {
    slug: loader.slugOf(product.documentId, locale),
    // O12: allergen/dietary codes travel as codes; serializers label them per locale.
    allergens: sanitizeAllergens(product.allergens),
    dietaryTags: sanitizeDietaryTags(product.dietaryTags),
    ...(kitchenStation ? { kitchenStation } : {}),
    availability: {
      reasons: verdict.reasons,
      ...(verdict.resumesAt ? { resumesAt: verdict.resumesAt.toISOString() } : {}),
    },
    variants: variants.map((row) => {
      const price = priceOf(row);
      return {
        ref: row.documentId,
        ...(row.sku ? { sku: row.sku } : {}),
        title: pick(row.name),
        isDefault: row.isDefault === true,
        price: price ? price.amount : null,
        ...(price?.compareAtAmount !== undefined ? { compareAtPrice: price.compareAtAmount } : {}),
        available: !stateBlocks(loader.stateOf(row.documentId), ctx.now),
      };
    }),
  };

  const fulfillmentKinds = asArray<string>(product.fulfillmentKinds);
  const sellable: Sellable = {
    ref: { uid: product.documentId, sourceDocumentId: product.documentId },
    productType: product.productType ?? 'food',
    title: pick(product.name) ?? product.documentId,
    ...(pick(product.description) ? { description: pick(product.description) } : {}),
    ...(product.image?.url ? { imageUrl: product.image.url } : {}),
    ...(variant
      ? {
          variant: {
            uid: variant.documentId,
            ...(variant.sku ? { sku: variant.sku } : {}),
            ...(pick(variant.name) ? { title: pick(variant.name) } : {}),
            attributes: variant.attributes ?? {},
            ...(variant.inventoryRef ? { inventoryRef: variant.inventoryRef } : {}),
          },
        }
      : {}),
    listPrice: selectedPrice
      ? toMoney(selectedPrice.amount, selectedPrice.currency)
      : toMoney(0, DEFAULT_CURRENCY),
    ...(selectedPrice?.compareAtAmount !== undefined
      ? { compareAtListPrice: toMoney(selectedPrice.compareAtAmount, selectedPrice.currency) }
      : {}),
    requiresShipping: fulfillmentKinds.includes('delivery'),
    isVirtual: false,
    isDownloadable: false,
    isGiftCard: (product.productType ?? 'food') === 'gift-card',
    fulfillmentKinds,
    options,
    availability: {},
    categories: categorySnapshots,
    ...(product.minQuantity !== undefined ? { minQuantity: product.minQuantity } : {}),
    ...(product.taxGroupRef ? { taxGroupRef: product.taxGroupRef } : {}),
    isActive: product.status === 'active' && categoryActive,
    purchasable: verdict.purchasable,
    metadata: {
      availabilityInput,
      catalog: catalogExtras,
      ...(normalizedSlots.length > 0 ? { bundleSlots: normalizedSlots } : {}),
    },
  };
  return sellable;
};

const PRODUCT_POPULATE = {
  image: true,
  variants: { populate: { prices: { populate: { priceList: true } } } },
  categories: { select: ['documentId'] },
  availabilityWindows: true,
};

type CatalogVariantInfo = {
  ref?: string;
  sku?: string;
  title?: string;
  isDefault?: boolean;
  price?: number | null;
  available?: boolean;
};

const catalogVariantsOf = (sellable: Sellable): CatalogVariantInfo[] | undefined => {
  const variants = (sellable.metadata as { catalog?: { variants?: unknown } } | undefined)?.catalog?.variants;
  return Array.isArray(variants) ? (variants as CatalogVariantInfo[]) : undefined;
};

/**
 * The sellable a product type prices for one line, with the chosen variant applied: its list price
 * is the context-selected price of that variant (price lists, groups, time) so `quoteLine` stays the
 * only place that decides `unitAmount` — a custom product type keeps its own pricing on top of it —
 * and `variant` (uid, sku, title) is the chosen one, so the order-line snapshot keeps what was
 * sold. A line that names no variant keeps the headline (default) variant untouched.
 *
 * A `variantUid` that is not a variant of this product is `VALIDATION_ERROR` (`lines.N.variantUid`)
 * and a tạm hết variant is `SELLABLE_UNAVAILABLE` — never a silent fall back to the default price.
 * Adapters that publish no `metadata.catalog.variants` cannot be checked and keep the sellable as is.
 */
export const sellableForLine = (
  sellable: Sellable,
  variantUid?: string | null,
  lineIndex = 0,
): Sellable => {
  if (!variantUid) return sellable;
  const variants = catalogVariantsOf(sellable);
  if (!variants) return sellable;
  const chosen = variants.find((row) => row.ref === variantUid);
  if (!chosen) {
    throw new OrderingError('VALIDATION_ERROR', 'variantUid is not a variant of this item', {
      details: { field: `lines.${lineIndex}.variantUid`, lineIndex },
    });
  }
  if (chosen.available === false) {
    throw new OrderingError('SELLABLE_UNAVAILABLE', 'variant is not available', {
      details: { lineIndex, reason: 'variant-unavailable' },
    });
  }
  const amount = typeof chosen.price === 'number' ? chosen.price : sellable.listPrice.amount;
  if (chosen.ref === sellable.variant?.uid && amount === sellable.listPrice.amount) return sellable;
  const isHeadline = chosen.ref === sellable.variant?.uid;
  return {
    ...sellable,
    ...(isHeadline || !chosen.title ? {} : { title: `${sellable.title} · ${chosen.title}` }),
    variant: {
      attributes: {},
      ...(isHeadline ? sellable.variant : {}),
      uid: variantUid,
      ...(chosen.sku ? { sku: chosen.sku } : {}),
      ...(chosen.title ? { title: chosen.title } : {}),
    },
    listPrice: { ...sellable.listPrice, amount },
  };
};

const cursorOf = (offset: number): string =>
  Buffer.from(JSON.stringify({ o: offset })).toString('base64url');
const parseCursor = (cursor?: string): number => {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
      o?: number;
    };
    return Number.isInteger(parsed.o) && (parsed.o as number) > 0 ? (parsed.o as number) : 0;
  } catch {
    return 0;
  }
};

/**
 * Real `ordering-catalog` adapter over the plugin catalog tables (contracts §20, plan step 6).
 * Normalizes products into Sellable: localized text falls back to `defaultLocale`, prices are
 * context-selected, modifier groups become OptionGroups with product overrides applied, bundle
 * slots become option groups plus `metadata.bundleSlots` (consumed for components snapshots).
 * `ref.uid` is the product documentId; a public slug resolves through `catalog-slug` too.
 */
export const createOrderingCatalogAdapter = ({ strapi }: { strapi: Core.Strapi }): CatalogAdapter => {
  const defaultLocale = (): string =>
    (strapi.config.get('plugin::ordering') as { catalog?: { defaultLocale?: string } }).catalog
      ?.defaultLocale ?? 'vi';
  const newLoader = () => createLoader(strapi, defaultLocale());
  const slugService = () =>
    strapi.plugin('ordering').service('catalog-slug') as ReturnType<typeof catalogSlugFactory>;

  const resolveProduct = async (
    loader: Loader,
    ref: SellableRef,
    locale: Locale,
  ): Promise<ProductRow | null> => {
    let product = (await strapi.db.query(PRODUCT).findOne({
      where: { documentId: ref.sourceDocumentId ?? ref.uid },
      populate: PRODUCT_POPULATE,
    })) as ProductRow | null;
    if (!product && ref.uid) {
      // Storefront lines may carry the public slug — resolve through catalog-slug.
      for (const code of [locale, loader.defaultLocale]) {
        const resolved = await slugService()
          .findDocumentId('catalog-product', code, ref.uid)
          .catch(() => null);
        if (resolved) {
          product = (await strapi.db.query(PRODUCT).findOne({
            where: { documentId: resolved },
            populate: PRODUCT_POPULATE,
          })) as ProductRow | null;
          break;
        }
      }
    }
    return product;
  };

  return {
    code: 'ordering-catalog',

    async listCategories(_ctx: AdapterContext, input: { locale: Locale }): Promise<JsonObject[]> {
      const loader = newLoader();
      const index = await loader.allCategories();
      await loader.collectSlugs(
        'catalog-category',
        [...index.values()].map((row) => row.documentId),
      );
      const rows = [...index.values()].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
      const output: JsonObject[] = [];
      for (const row of rows) {
        const chain = [...(await loader.ancestorsOf(row.documentId)).reverse(), row];
        output.push({
          ref: row.documentId,
          slug: loader.slugOf(row.documentId, input.locale) ?? null,
          title:
            resolveLocalizedText(row.name, input.locale, loader.defaultLocale) ?? row.documentId,
          description: resolveLocalizedText(row.description, input.locale, loader.defaultLocale),
          parentRef: row.parent?.documentId ?? null,
          path: chain.map((item) => item.documentId),
          rank: row.rank ?? 0,
          isActive: row.isActive !== false,
          isInternal: row.isInternal === true,
          kitchenStation: normalizeKitchenStation(row.kitchenStation),
        });
      }
      return output;
    },

    async listSellables(
      ctx: AdapterContext,
      input: { locale: Locale; categoryRef?: string; cursor?: string; limit: number },
    ) {
      const loader = newLoader();
      const where: JsonObject = { status: 'active', sellOnline: true };
      if (input.categoryRef) {
        // Category filter accepts a documentId or a slug in the requested/default locale.
        const index = await loader.allCategories();
        let categoryRef = index.has(input.categoryRef) ? input.categoryRef : null;
        if (!categoryRef) {
          for (const code of [input.locale, loader.defaultLocale]) {
            const resolved = await slugService()
              .findDocumentId('catalog-category', code, input.categoryRef)
              .catch(() => null);
            if (resolved) {
              categoryRef = resolved;
              break;
            }
          }
        }
        if (!categoryRef) return { items: [] };
        where.categories = { documentId: categoryRef };
      }
      const offset = parseCursor(input.cursor);
      const limit = Math.min(Math.max(input.limit || 24, 1), 50);
      const rows = (await strapi.db.query(PRODUCT).findMany({
        where,
        orderBy: [{ rank: 'asc' }, { documentId: 'asc' }],
        offset,
        limit: limit + 1,
        populate: PRODUCT_POPULATE,
      })) as ProductRow[];
      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const items = await Promise.all(
        page.map((row) => toSellable(strapi, loader, row, ctx, input.locale)),
      );
      return { items, ...(hasMore ? { nextCursor: cursorOf(offset + limit) } : {}) };
    },

    async getSellable(
      ctx: AdapterContext,
      ref: SellableRef,
      input: { locale: Locale },
    ): Promise<Sellable | null> {
      const product = await resolveProduct(newLoader(), ref, input.locale);
      if (!product) return null;
      return toSellable(strapi, newLoader(), product, ctx, input.locale);
    },

    async getListPrice(_ctx: AdapterContext, sellable: Sellable): Promise<Money> {
      return sellable.listPrice;
    },

    async getAvailability(
      ctx: AdapterContext,
      sellable: Sellable,
      quantity: number,
    ): Promise<AvailabilityResult> {
      const input = sellable.metadata?.availabilityInput as AvailabilityInput | undefined;
      if (!input) {
        return {
          available: sellable.purchasable,
          ...(sellable.purchasable ? {} : { reasonCode: 'unavailable' }),
        };
      }
      // Re-evaluate against `now` — the Sellable may have been built moments ago.
      const verdict = evaluateAvailability({
        ...input,
        nowLocal: branchLocal(ctx.now, input.timezone),
        now: new Date(ctx.now),
      });
      if (!verdict.purchasable) {
        return { available: false, reasonCode: verdict.reasons[0] ?? 'unavailable' };
      }
      const minimum = sellable.minQuantity ?? 1;
      if (!Number.isInteger(quantity) || quantity < minimum) {
        return { available: false, reasonCode: 'quantity-below-minimum' };
      }
      return { available: true };
    },
  };
};
