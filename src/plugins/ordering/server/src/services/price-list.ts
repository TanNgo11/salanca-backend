import type { Core } from '@strapi/strapi';

import {
  parsePriceListInput,
  rulesOf,
  type PriceListInput,
} from '../domain/catalog/price-list-input';
import {
  applyAdjustLists,
  explainPrice,
  priceRulesMatch,
  selectCatalogPrice,
  type AdjustList,
  type CatalogPriceRow,
  type CatalogPriceRules,
} from '../domain/catalog/price-selection';
import { OrderingError } from '../domain/errors';
import { resolveLocalizedText } from '../domain/catalog/localized-text';
import type { ServiceContext } from './context';
import { actorRefOf } from './context';
import type changeLogFactory from './change-log';

const LIST = 'plugin::ordering.price-list';
const PRICE = 'plugin::ordering.catalog-price';
const VARIANT = 'plugin::ordering.catalog-variant';
const BRANCH = 'plugin::ordering.branch';

type ListRow = {
  id: number;
  documentId: string;
  name: { vi?: string; en?: string } | null;
  kind: 'override' | 'adjust';
  rules: CatalogPriceRules | null;
  adjust: AdjustList['adjust'] | null;
  lines: PriceListInput['lines'] | null;
  priority: number;
  active: boolean;
  validFrom: string | null;
  validTo: string | null;
  createdByRef: string | null;
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return (value ?? fallback) as T;
};

const asRules = (value: unknown): CatalogPriceRules =>
  parseJson<CatalogPriceRules>(value, {});

/** One row the selector can read. Inactive owning lists are marked so they lose. */
export const toAdjustList = (row: {
  id: number;
  name?: unknown;
  priority?: number | null;
  active?: boolean | null;
  rules?: unknown;
  adjust?: unknown;
  validFrom?: string | null;
  validTo?: string | null;
}, locale = 'vi'): AdjustList | null => {
  const adjust = parseJson<AdjustList['adjust'] | null>(row.adjust, null);
  if (!adjust || (adjust.type !== 'percent' && adjust.type !== 'amount')) return null;
  const name = parseJson<{ vi?: string; en?: string }>(row.name, {});
  return {
    id: row.id,
    name: name[locale as 'vi'] ?? name.vi ?? name.en ?? '',
    priority: row.priority ?? 0,
    active: row.active !== false,
    rules: asRules(row.rules),
    adjust,
    validFrom: row.validFrom,
    validTo: row.validTo,
  };
};

const priceList = ({ strapi }: { strapi: Core.Strapi }) => {
  const lists = () => strapi.db.query(LIST);
  const prices = () => strapi.db.query(PRICE);
  const changeLog = () => strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  const load = async (id: number): Promise<ListRow> => {
    const row = (await lists().findOne({ where: { id } })) as ListRow | null;
    if (!row) throw new OrderingError('PRICE_LIST_NOT_FOUND', 'price list not found');
    return {
      ...row,
      name: parseJson(row.name, {}),
      rules: asRules(row.rules),
      adjust: parseJson(row.adjust, null),
      lines: parseJson(row.lines, []),
    };
  };

  const view = (row: ListRow) => ({
    id: row.id,
    name: row.name ?? { vi: '' },
    kind: row.kind,
    rules: row.rules ?? {},
    adjust: row.adjust,
    lines: row.lines ?? [],
    priority: row.priority ?? 0,
    active: row.active !== false,
    validFrom: row.validFrom,
    validTo: row.validTo,
  });

  const assertVariants = async (lines: PriceListInput['lines']) => {
    if (lines.length === 0) return;
    const found = (await strapi.db.query(VARIANT).findMany({
      where: { documentId: { $in: lines.map((line) => line.variantId) } },
      select: ['documentId'],
    })) as Array<{ documentId: string }>;
    const ids = new Set(found.map((row) => row.documentId));
    const missing = lines.map((line) => line.variantId).filter((id) => !ids.has(id));
    if (missing.length > 0) {
      throw new OrderingError('PRICE_LIST_INVALID', 'unknown variant', {
        details: { issues: [{ path: 'lines', message: 'unknown variant' }] },
      });
    }
  };

  /** Replace the catalog-price rows an override list owns. An inactive list keeps them; selection skips them. */
  const syncOverride = async (row: ListRow, input: PriceListInput) => {
    const existing = (await prices().findMany({
      where: { priceList: row.id },
      select: ['id'],
    })) as Array<{ id: number }>;
    if (existing.length > 0) {
      await prices().deleteMany({ where: { id: { $in: existing.map((item) => item.id) } } });
    }
    if (input.kind !== 'override') return;
    const rules = rulesOf(input);
    const channels = rules.channels?.length ? rules.channels : [undefined];
    const locations = rules.locationRefs?.length ? rules.locationRefs : [undefined];
    const groups = rules.customerGroups?.length ? rules.customerGroups : [undefined];
    for (const line of input.lines) {
      const variant = (await strapi.db.query(VARIANT).findOne({
        where: { documentId: line.variantId },
        select: ['id'],
      })) as { id: number } | null;
      if (!variant) continue;
      for (const channel of channels) {
        for (const locationRef of locations) {
          for (const customerGroup of groups) {
            await prices().create({
              data: {
                variant: variant.id,
                amount: line.amount,
                ...(line.compareAtAmount != null ? { compareAtAmount: line.compareAtAmount } : {}),
                currency: 'VND',
                minQuantity: 1,
                rules: {
                  ...(channel ? { channel } : {}),
                  ...(locationRef ? { locationRef } : {}),
                  ...(customerGroup ? { customerGroup } : {}),
                  ...(rules.weekdays?.length ? { weekdays: rules.weekdays } : {}),
                  ...(rules.timeRanges?.length ? { timeRanges: rules.timeRanges } : {}),
                },
                priority: input.priority,
                validFrom: input.validFrom ?? null,
                validTo: input.validTo ?? null,
                priceList: row.id,
              },
            });
          }
        }
      }
    }
  };

  const dataOf = (input: PriceListInput, ctx: ServiceContext, creating: boolean) => ({
    name: input.name,
    kind: input.kind,
    rules: rulesOf(input),
    adjust: input.kind === 'adjust' ? input.adjust : null,
    lines: input.kind === 'override' ? input.lines : [],
    priority: input.priority,
    active: input.active,
    validFrom: input.validFrom ?? null,
    validTo: input.validTo ?? null,
    ...(creating ? { createdByRef: actorRefOf(ctx) } : {}),
  });

  return {
    toAdjustList,

    /** Active adjust lists, parsed for the catalog adapter. */
    async activeAdjustLists(locale = 'vi'): Promise<AdjustList[]> {
      const rows = (await lists().findMany({ where: { kind: 'adjust', active: true } })) as ListRow[];
      return rows.flatMap((row) => {
        const list = toAdjustList(row, locale);
        return list ? [list] : [];
      });
    },

    async list() {
      const rows = (await lists().findMany({ orderBy: [{ priority: 'desc' }, { id: 'desc' }] })) as ListRow[];
      return { items: rows.map((row) => view({ ...row, rules: asRules(row.rules), lines: parseJson(row.lines, []), adjust: parseJson(row.adjust, null), name: parseJson(row.name, {}) })) };
    },

    async get(id: number) {
      return { item: view(await load(id)) };
    },

    async create(raw: unknown, ctx: ServiceContext) {
      const input = parsePriceListInput(raw);
      await assertVariants(input.lines);
      const created = (await lists().create({ data: dataOf(input, ctx, true) })) as ListRow;
      const row = await load(created.id);
      await syncOverride(row, input);
      await changeLog().record(
        {
          action: 'price-list.create',
          entityType: 'price-list',
          entityId: row.id,
          entityLabel: input.name.vi,
          after: { kind: input.kind, priority: input.priority, active: input.active, lines: input.lines.length },
        },
        ctx,
      );
      return { item: view(await load(row.id)) };
    },

    async update(id: number, raw: unknown, ctx: ServiceContext) {
      const before = await load(id);
      const input = parsePriceListInput(raw);
      await assertVariants(input.lines);
      await lists().update({ where: { id }, data: dataOf(input, ctx, false) });
      await syncOverride(await load(id), input);
      await changeLog().record(
        {
          action: 'price-list.update',
          entityType: 'price-list',
          entityId: id,
          entityLabel: input.name.vi,
          before: { kind: before.kind, priority: before.priority, active: before.active },
          after: { kind: input.kind, priority: input.priority, active: input.active, lines: input.lines.length },
        },
        ctx,
      );
      return { item: view(await load(id)) };
    },

    async setActive(id: number, active: unknown, ctx: ServiceContext) {
      if (typeof active !== 'boolean') {
        throw new OrderingError('PRICE_LIST_INVALID', 'active must be a boolean', {
          details: { issues: [{ path: 'active', message: 'expected boolean' }] },
        });
      }
      const before = await load(id);
      await lists().update({ where: { id }, data: { active } });
      await changeLog().record(
        {
          action: 'price-list.active',
          entityType: 'price-list',
          entityId: id,
          entityLabel: before.name?.vi ?? null,
          before: { active: before.active },
          after: { active },
        },
        ctx,
      );
      return { item: view(await load(id)) };
    },

    /** Branches, categories, variants and groups the editor offers. */
    async options(locale: string) {
      const code = locale === 'en' ? 'en' : 'vi';
      const branches = (await strapi.db.query(BRANCH).findMany({
        where: { isActive: true },
        select: ['code', 'name'],
      })) as Array<{ code: string; name?: unknown }>;
      const categories = (await strapi.db.query('plugin::ordering.catalog-category').findMany({
        select: ['documentId', 'name'],
      })) as Array<{ documentId: string; name?: unknown }>;
      const variants = (await strapi.db.query(VARIANT).findMany({
        populate: {
          product: { populate: { categories: { select: ['documentId'] } } },
          prices: true,
        },
        limit: 500,
      })) as Array<{
        documentId: string;
        sku?: string;
        name?: unknown;
        product?: { documentId?: string; name?: unknown; categories?: Array<{ documentId?: string }> } | null;
        prices?: CatalogPriceRow[];
      }>;
      const groups = (await strapi.db.query('plugin::ordering.customer-group').findMany({
        where: { active: true },
        select: ['code', 'name'],
      })) as Array<{ code: string; name?: unknown }>;
      const title = (value: unknown, fallback: string) => resolveLocalizedText(value, code, 'vi') ?? fallback;
      return {
        branches: branches.map((row) => ({ code: row.code, name: title(row.name, row.code) })),
        categories: categories.map((row) => ({ ref: row.documentId, title: title(row.name, row.documentId) })),
        variants: variants.map((row) => {
          const base = row.prices?.length ? selectCatalogPrice(row.prices, {}) : null;
          return {
            variantId: row.documentId,
            productId: row.product?.documentId ?? '',
            title: title(row.name, row.sku ?? row.documentId),
            productTitle: title(row.product?.name, row.product?.documentId ?? ''),
            ...(row.sku ? { sku: row.sku } : {}),
            baseAmount: base?.amount ?? null,
            categoryRefs: (row.product?.categories ?? []).map((category) => category.documentId).filter(Boolean),
          };
        }),
        groups: groups.map((row) => ({ code: row.code, name: title(row.name, row.code) })),
      };
    },

    /**
     * POST /price-preview. Shows the price a context would pay and which list won.
     * Does not read a customer phone — the caller names a group code, if any.
     */
    async preview(raw: unknown) {
      const body = (raw ?? {}) as Record<string, unknown>;
      const variantId = typeof body.variantId === 'string' ? body.variantId.trim() : '';
      if (!variantId) {
        throw new OrderingError('PRICE_LIST_INVALID', 'variantId is required', {
          details: { issues: [{ path: 'variantId', message: 'required' }] },
        });
      }
      const channel = typeof body.channel === 'string' ? body.channel : undefined;
      const locationRef = typeof body.locationRef === 'string' ? body.locationRef : undefined;
      const customerGroup = typeof body.customerGroup === 'string' && body.customerGroup ? body.customerGroup : undefined;
      const at = typeof body.at === 'string' && !Number.isNaN(Date.parse(body.at)) ? new Date(body.at) : new Date();
      const variant = (await strapi.db.query(VARIANT).findOne({
        where: { documentId: variantId },
        populate: {
          product: { populate: { categories: { select: ['documentId'] } } },
          prices: { populate: { priceList: true } },
        },
      })) as {
        documentId: string;
        product?: { documentId?: string; categories?: Array<{ documentId?: string }> } | null;
        prices?: Array<CatalogPriceRow & { priceList?: { id?: number; active?: boolean; name?: unknown; kind?: string } | null }>;
      } | null;
      if (!variant) throw new OrderingError('PRICE_LIST_NOT_FOUND', 'variant not found');
      const branch = locationRef
        ? ((await strapi.db.query(BRANCH).findOne({ where: { code: locationRef }, select: ['timezone'] })) as { timezone?: string } | null)
        : null;
      const ctx = {
        at,
        locationRef,
        channel,
        ...(customerGroup ? { customerGroups: [customerGroup] } : {}),
        timezone: branch?.timezone ?? 'Asia/Ho_Chi_Minh',
      };
      const rows = variant.prices ?? [];
      const categoryRefs = (variant.product?.categories ?? []).map((category) => category.documentId).filter((ref): ref is string => Boolean(ref));
      const variantCtx = {
        variantRef: variant.documentId,
        productRef: variant.product?.documentId,
        categoryRefs,
      };
      const adjustLists = await this.activeAdjustLists('vi');
      const base = selectCatalogPrice(rows, ctx);
      const adjusted = base ? applyAdjustLists(base, adjustLists, variantCtx, ctx) : null;
      const explained = explainPrice(rows, adjustLists, variantCtx, ctx);
      const winningList = adjusted?.priceListId
        ? adjustLists.find((list) => list.id === adjusted.priceListId)
        : undefined;
      const baseList = rows.find((row) => priceRulesMatch(row.rules, ctx) && row.priceList && row.priceList.active !== false);
      return {
        amount: adjusted?.amount ?? null,
        ...(adjusted?.compareAtAmount !== undefined ? { compareAtAmount: adjusted.compareAtAmount } : {}),
        currency: 'VND',
        winner: adjusted
          ? winningList
            ? { kind: 'list' as const, id: winningList.id, name: winningList.name ?? '' }
            : {
                kind: 'base' as const,
                ...(baseList?.priceList?.id ? { id: baseList.priceList.id } : {}),
                name: baseList?.priceList
                  ? (parseJson<{ vi?: string }>(baseList.priceList.name, {}).vi ?? '')
                  : '',
              }
          : null,
        candidates: explained.candidates.map((candidate) => ({
          ...candidate,
          ...(candidate.amount !== undefined ? { amount: candidate.amount } : {}),
        })),
      };
    },
  };
};

export default priceList;
