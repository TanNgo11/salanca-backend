import { randomInt } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { buildCsv } from '../domain/csv';
import { OrderingError } from '../domain/errors';
import { parsePromotionInput, type PromotionInput } from '../domain/promotions/schema';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import { normalizePromotionCode } from './promotion';
import type { OrderingRegistry } from './registry';

/**
 * Admin side of promotions (O8 step 5, screens K1–K4), `promotion.manage`. Promotions are
 * chain-wide (a branch list is a condition, not an owner), so there is no location scope here.
 * `usedCount` and `kind` are never written from input: uses move only under the reservation
 * lock in `services/promotion`, and switching kind would change how existing codes behave.
 * Codes are logged by count and their last 4 characters, never in full.
 */
const PAGE_SIZE = 50;
const MAX_GENERATE = 5000;
/** No 0/O/1/I/L — codes are read aloud and typed from paper. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const SOLD_STATUSES = ['open', 'completed'];
export const PROMOTION_TABS = ['running', 'scheduled', 'off', 'expired', 'all'] as const;
export type PromotionTab = (typeof PROMOTION_TABS)[number];

type PromotionRow = PromotionInput & {
  id: number;
  usedCount: number;
  createdByRef: string | null;
  createdAt?: string;
  updatedAt?: string;
};

type CodeRow = {
  id: number;
  promotionId: number;
  code: string;
  usageLimit: number | null;
  usedCount: number;
  active: boolean;
  batch: string | null;
  createdAt?: string;
};

const parseJson = <T>(value: unknown, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value as T;
};

const tail = (code: string) => code.slice(-4);

const statusOf = (row: Pick<PromotionRow, 'active' | 'startsAt' | 'endsAt'>, now: Date): Exclude<PromotionTab, 'all'> => {
  if (!row.active) return 'off';
  if (row.endsAt && new Date(row.endsAt).getTime() <= now.getTime()) return 'expired';
  if (new Date(row.startsAt).getTime() > now.getTime()) return 'scheduled';
  return 'running';
};

const promotionAdmin = ({ strapi }: { strapi: Core.Strapi }) => {
  const promotions = () => strapi.db.query('plugin::ordering.promotion');
  const codes = () => strapi.db.query('plugin::ordering.promotion-code');
  const knex = () => strapi.db.connection;
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  const view = (row: PromotionRow, now: Date, stats?: { orders: number; discount: number }) => ({
    id: row.id,
    name: parseJson(row.name, { vi: '' }),
    internalNote: row.internalNote ?? null,
    kind: row.kind,
    discountType: row.discountType,
    value: row.value ?? null,
    maxDiscount: row.maxDiscount ?? null,
    target: parseJson(row.target, { kind: 'order', refs: [] }),
    minSubtotal: row.minSubtotal ?? 0,
    locationRefs: parseJson<string[] | null>(row.locationRefs, null),
    receiveKinds: parseJson(row.receiveKinds, ['pickup', 'delivery']),
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
    weekdays: parseJson(row.weekdays, []),
    timeRanges: parseJson(row.timeRanges, []),
    firstOrderOnly: row.firstOrderOnly,
    customerGroups: parseJson<string[]>(row.customerGroups, []),
    usageLimit: row.usageLimit ?? null,
    perCustomerLimit: row.perCustomerLimit ?? null,
    stackable: row.stackable,
    priority: row.priority ?? 0,
    active: row.active,
    usedCount: row.usedCount ?? 0,
    status: statusOf(row, now),
    orders: stats?.orders ?? 0,
    discountTotal: stats?.discount ?? 0,
    createdAt: row.createdAt ?? null,
  });

  /** Σ discount and order count per promotion from sold orders' adjustments (same as reports). */
  const statsFor = async (ids: number[]) => {
    const out = new Map<number, { orders: number; discount: number; revenue: number }>();
    if (ids.length === 0) return out;
    const rows = (await knex()
      .from('plugins_ordering_order_adjustment as a')
      .join('plugins_ordering_order_adjustment_order_lnk as link', 'link.order_adjustment_id', 'a.id')
      .join('plugins_ordering_order as o', 'o.id', 'link.order_id')
      .whereIn('a.source_ref', ids.map((id) => `promotion:${id}`))
      .whereIn('o.status', SOLD_STATUSES)
      .groupBy('a.source_ref')
      .select('a.source_ref')
      .select(knex().raw('count(distinct link.order_id)::int as orders'))
      .select(knex().raw('coalesce(sum(a.amount), 0) as discount'))
      .select(knex().raw('coalesce(sum(o.total_amount), 0) as revenue'))) as Array<{
      source_ref: string;
      orders: number;
      discount: string | number;
      revenue: string | number;
    }>;
    for (const row of rows) {
      out.set(Number(row.source_ref.split(':')[1]), {
        orders: Number(row.orders),
        discount: -Number(row.discount),
        revenue: Number(row.revenue),
      });
    }
    return out;
  };

  const find = async (id: number): Promise<PromotionRow> => {
    const row = (await promotions().findOne({ where: { id } })) as PromotionRow | null;
    if (!row) throw new OrderingError('PROMOTION_NOT_FOUND', 'promotion not found');
    return row;
  };

  const dataOf = (input: PromotionInput) => ({
    name: input.name,
    internalNote: input.internalNote ?? null,
    discountType: input.discountType,
    value: input.value ?? null,
    maxDiscount: input.maxDiscount ?? null,
    target: input.target,
    minSubtotal: input.minSubtotal,
    locationRefs: input.locationRefs && input.locationRefs.length > 0 ? input.locationRefs : null,
    receiveKinds: input.receiveKinds,
    startsAt: input.startsAt,
    endsAt: input.endsAt ?? null,
    weekdays: input.weekdays,
    timeRanges: input.timeRanges,
    firstOrderOnly: input.firstOrderOnly,
    customerGroups: input.customerGroups,
    usageLimit: input.usageLimit ?? null,
    perCustomerLimit: input.perCustomerLimit ?? null,
    stackable: input.stackable,
    priority: input.priority,
    active: input.active,
  });

  /** Inserts codes, skipping any that already exist (case-insensitive). Returns the inserted count. */
  const insertCodes = async (
    promotionId: number,
    list: string[],
    usageLimit: number | null,
    batch: string | null,
  ): Promise<number> => {
    if (list.length === 0) return 0;
    const now = new Date();
    let inserted = 0;
    for (let start = 0; start < list.length; start += 500) {
      const chunk = list.slice(start, start + 500);
      const result = await knex().raw(
        `INSERT INTO plugins_ordering_promotion_code
           (document_id, promotion_id, code, usage_limit, used_count, active, batch, created_at, updated_at)
         SELECT md5(random()::text || clock_timestamp()::text), ?, c, ?, 0, true, ?, ?, ?
         FROM unnest(?::text[]) AS c
         ON CONFLICT ((upper(code))) DO NOTHING`,
        [promotionId, usageLimit, batch, now, now, chunk],
      );
      inserted += Number((result as { rowCount?: number }).rowCount ?? 0);
    }
    return inserted;
  };

  const randomCode = (prefix: string, length: number): string => {
    let body = '';
    for (let index = 0; index < length; index += 1) body += ALPHABET[randomInt(ALPHABET.length)];
    return `${prefix}${body}`;
  };

  return {
    async list(
      query: { status?: string; kind?: string; q?: string; page?: number },
      ctx: ServiceContext,
    ) {
      const now = nowOf(ctx);
      const tab = (query.status ?? 'all') as PromotionTab;
      if (!PROMOTION_TABS.includes(tab)) {
        throw new OrderingError('VALIDATION_ERROR', 'status must be a promotion tab', {
          details: { field: 'status' },
        });
      }
      const builder = knex().from('plugins_ordering_promotion as p').select('p.id');
      if (query.kind === 'code' || query.kind === 'auto') builder.where('p.kind', query.kind);
      if (tab === 'off') builder.where('p.active', false);
      if (tab === 'running') {
        builder
          .where('p.active', true)
          .where('p.starts_at', '<=', now)
          .where((q) => q.whereNull('p.ends_at').orWhere('p.ends_at', '>', now));
      }
      if (tab === 'scheduled') builder.where('p.active', true).where('p.starts_at', '>', now);
      if (tab === 'expired') builder.where('p.active', true).where('p.ends_at', '<=', now);
      const q = query.q?.trim();
      if (q) {
        const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
        builder.where((where) =>
          where
            .whereRaw('p.name::text ILIKE ?', [like])
            .orWhereExists(
              knex()
                .from('plugins_ordering_promotion_code as c')
                .whereRaw('c.promotion_id = p.id')
                .whereRaw('upper(c.code) LIKE upper(?)', [like]),
            ),
        );
      }
      const ids = ((await builder.orderBy('p.id', 'desc')) as Array<{ id: number }>).map((row) => row.id);
      const page = query.page ?? 1;
      const pageIds = ids.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
      const rows = (await promotions().findMany({ where: { id: { $in: pageIds } } })) as PromotionRow[];
      const byId = new Map(rows.map((row) => [row.id, row]));
      const stats = await statsFor(pageIds);
      return {
        items: pageIds
          .map((id) => byId.get(id))
          .filter((row): row is PromotionRow => row !== undefined)
          .map((row) => view(row, now, stats.get(row.id))),
        pagination: { page, pageSize: PAGE_SIZE, total: ids.length },
      };
    },

    async get(id: number, ctx: ServiceContext) {
      const row = await find(id);
      const stats = (await statsFor([id])).get(id);
      const reserved = await strapi.db
        .query('plugin::ordering.promotion-redemption')
        .count({ where: { promotionId: id, status: 'reserved' } });
      const codeCount = await codes().count({ where: { promotionId: id } });
      return {
        promotion: view(row, nowOf(ctx), stats),
        stats: {
          orders: stats?.orders ?? 0,
          discountTotal: stats?.discount ?? 0,
          revenue: stats?.revenue ?? 0,
          reserved,
        },
        codeCount,
      };
    },

    /** POST /promotions — body = promotion input + optional `code` for a code promotion. */
    async create(body: unknown, ctx: ServiceContext) {
      const raw = { ...((body ?? {}) as Record<string, unknown>) };
      const firstCode = raw.code;
      delete raw.code;
      const input = parsePromotionInput(raw);
      let normalized: string | null = null;
      if (firstCode !== undefined && firstCode !== null && firstCode !== '') {
        if (input.kind !== 'code') {
          throw new OrderingError('VALIDATION_ERROR', 'an automatic promotion has no code', {
            details: { issues: [{ path: 'code', message: 'an automatic promotion has no code' }] },
          });
        }
        normalized = typeof firstCode === 'string' ? normalizePromotionCode(firstCode) : null;
        if (!normalized) {
          throw new OrderingError('VALIDATION_ERROR', 'code must be 4-32 of A-Z, 0-9 and -', {
            details: { issues: [{ path: 'code', message: 'code must be 4-32 of A-Z, 0-9 and -' }] },
          });
        }
      }
      const created = await strapi.db.transaction(async () => {
        const row = (await promotions().create({
          data: { ...dataOf(input), kind: input.kind, usedCount: 0, createdByRef: actorRefOf(ctx) },
        })) as PromotionRow;
        if (normalized && (await insertCodes(row.id, [normalized], null, null)) === 0) {
          throw new OrderingError('VALIDATION_ERROR', 'this code already exists', {
            details: { issues: [{ path: 'code', message: 'code already exists' }] },
          });
        }
        await changeLog().record(
          {
            action: 'promotion.create',
            entityType: 'promotion',
            entityId: row.id,
            entityLabel: input.name.vi,
            after: { ...dataOf(input), kind: input.kind, ...(normalized ? { codeTail: tail(normalized) } : {}) },
          },
          ctx,
        );
        return row;
      });
      return this.get(created.id, ctx);
    },

    /** PUT /promotions/:id — conditions change for new orders only; kind and uses never change here. */
    async update(id: number, body: unknown, ctx: ServiceContext) {
      const before = await find(id);
      const raw: Record<string, unknown> = { ...((body ?? {}) as Record<string, unknown>), kind: before.kind };
      delete raw.code;
      delete raw.usedCount;
      const input = parsePromotionInput(raw);
      await promotions().update({ where: { id }, data: dataOf(input) });
      await changeLog().record(
        {
          action: 'promotion.update',
          entityType: 'promotion',
          entityId: id,
          entityLabel: input.name.vi,
          before: storedData(view(before, nowOf(ctx))),
          after: dataOf(input),
        },
        ctx,
      );
      return this.get(id, ctx);
    },

    async setActive(id: number, active: unknown, ctx: ServiceContext) {
      if (typeof active !== 'boolean') {
        throw new OrderingError('VALIDATION_ERROR', 'active must be a boolean', { details: { field: 'active' } });
      }
      const before = await find(id);
      if (before.active !== active) {
        await promotions().update({ where: { id }, data: { active } });
        await changeLog().record(
          {
            action: 'promotion.active',
            entityType: 'promotion',
            entityId: id,
            entityLabel: parseJson(before.name, { vi: '' }).vi,
            before: { active: before.active },
            after: { active },
          },
          ctx,
        );
      }
      return this.get(id, ctx);
    },

    async listCodes(id: number, query: { q?: string; page?: number }) {
      await find(id);
      const page = query.page ?? 1;
      const q = query.q?.trim().toUpperCase();
      const where = { promotionId: id, ...(q ? { code: { $containsi: q } } : {}) };
      const [items, total] = await Promise.all([
        codes().findMany({
          where,
          orderBy: [{ id: 'desc' }],
          offset: (page - 1) * PAGE_SIZE,
          limit: PAGE_SIZE,
        }) as Promise<CodeRow[]>,
        codes().count({ where }),
      ]);
      return {
        items: items.map((row) => ({
          id: row.id,
          code: row.code,
          usageLimit: row.usageLimit,
          usedCount: row.usedCount ?? 0,
          active: row.active,
          batch: row.batch,
          createdAt: row.createdAt ?? null,
        })),
        pagination: { page, pageSize: PAGE_SIZE, total },
      };
    },

    /**
     * POST /promotions/:id/codes — `{ code, usageLimit? }` adds one; `{ generate: { count, prefix,
     * length, usageLimit, batch } }` makes up to 5000 random unique codes (tops up collisions).
     */
    async addCodes(id: number, body: unknown, ctx: ServiceContext) {
      const promotion = await find(id);
      if (promotion.kind !== 'code') {
        throw new OrderingError('VALIDATION_ERROR', 'only a code promotion has codes', {
          details: { issues: [{ path: 'kind', message: 'only a code promotion has codes' }] },
        });
      }
      const input = (body ?? {}) as {
        code?: unknown;
        usageLimit?: unknown;
        generate?: { count?: unknown; prefix?: unknown; length?: unknown; usageLimit?: unknown; batch?: unknown };
      };
      const limitOf = (value: unknown, path: string): number | null => {
        if (value === undefined || value === null || value === '') return null;
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
          throw new OrderingError('VALIDATION_ERROR', 'usageLimit must be a positive integer', {
            details: { issues: [{ path, message: 'usageLimit must be a positive integer' }] },
          });
        }
        return value;
      };
      const label = parseJson(promotion.name, { vi: '' }).vi;

      if (input.generate) {
        const { count, prefix = '', length = 10, batch } = input.generate;
        if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_GENERATE) {
          throw new OrderingError('VALIDATION_ERROR', `count must be 1-${MAX_GENERATE}`, {
            details: { issues: [{ path: 'generate.count', message: `count must be 1-${MAX_GENERATE}` }] },
          });
        }
        const cleanPrefix = typeof prefix === 'string' ? prefix.trim().toUpperCase() : '';
        if (!/^[A-Z0-9-]{0,12}$/.test(cleanPrefix)) {
          throw new OrderingError('VALIDATION_ERROR', 'prefix must be up to 12 of A-Z, 0-9 and -', {
            details: { issues: [{ path: 'generate.prefix', message: 'invalid prefix' }] },
          });
        }
        if (typeof length !== 'number' || !Number.isInteger(length) || length < 8 || length > 16) {
          throw new OrderingError('VALIDATION_ERROR', 'length must be 8-16', {
            details: { issues: [{ path: 'generate.length', message: 'length must be 8-16' }] },
          });
        }
        if (cleanPrefix.length + length > 32) {
          throw new OrderingError('VALIDATION_ERROR', 'prefix + length must be at most 32', {
            details: { issues: [{ path: 'generate.prefix', message: 'prefix + length must be at most 32' }] },
          });
        }
        const usageLimit = input.generate.usageLimit === undefined ? 1 : limitOf(input.generate.usageLimit, 'generate.usageLimit');
        const batchName = typeof batch === 'string' && batch.trim() !== '' ? batch.trim().slice(0, 60) : null;
        let made = 0;
        for (let round = 0; round < 5 && made < count; round += 1) {
          const wanted = new Set<string>();
          while (wanted.size < count - made) wanted.add(randomCode(cleanPrefix, length));
          made += await insertCodes(id, [...wanted], usageLimit, batchName);
        }
        if (made < count) {
          throw new OrderingError('INTERNAL', 'could not generate enough unique codes');
        }
        await changeLog().record(
          {
            action: 'promotion.codes-generate',
            entityType: 'promotion',
            entityId: id,
            entityLabel: label,
            after: { count: made, prefix: cleanPrefix, length, usageLimit, batch: batchName },
          },
          ctx,
        );
        return { generated: made, batch: batchName };
      }

      const normalized = typeof input.code === 'string' ? normalizePromotionCode(input.code) : null;
      if (!normalized) {
        throw new OrderingError('VALIDATION_ERROR', 'code must be 4-32 of A-Z, 0-9 and -', {
          details: { issues: [{ path: 'code', message: 'code must be 4-32 of A-Z, 0-9 and -' }] },
        });
      }
      const usageLimit = limitOf(input.usageLimit, 'usageLimit');
      if ((await insertCodes(id, [normalized], usageLimit, null)) === 0) {
        throw new OrderingError('VALIDATION_ERROR', 'this code already exists', {
          details: { issues: [{ path: 'code', message: 'code already exists' }] },
        });
      }
      await changeLog().record(
        {
          action: 'promotion.code-create',
          entityType: 'promotion',
          entityId: id,
          entityLabel: label,
          after: { codeTail: tail(normalized), usageLimit },
        },
        ctx,
      );
      return { generated: 1, batch: null };
    },

    async setCodeActive(codeId: number, active: unknown, ctx: ServiceContext) {
      if (typeof active !== 'boolean') {
        throw new OrderingError('VALIDATION_ERROR', 'active must be a boolean', { details: { field: 'active' } });
      }
      const row = (await codes().findOne({ where: { id: codeId } })) as CodeRow | null;
      if (!row) throw new OrderingError('PROMOTION_NOT_FOUND', 'promotion code not found');
      if (row.active !== active) {
        await codes().update({ where: { id: codeId }, data: { active } });
        await changeLog().record(
          {
            action: 'promotion.code-active',
            entityType: 'promotion',
            entityId: row.promotionId,
            entityLabel: `…${tail(row.code)}`,
            before: { active: row.active },
            after: { active },
          },
          ctx,
        );
      }
      return { id: codeId, active };
    },

    /** GET /promotions/:id/codes/export — `promotion.manage` + `export`. */
    async exportCodes(id: number, ctx: ServiceContext) {
      const promotion = await find(id);
      const rows = (await codes().findMany({
        where: { promotionId: id },
        orderBy: [{ id: 'asc' }],
      })) as CodeRow[];
      await changeLog().record(
        {
          action: 'promotion.codes-export',
          entityType: 'promotion',
          entityId: id,
          entityLabel: parseJson(promotion.name, { vi: '' }).vi,
          after: { rows: rows.length },
        },
        ctx,
      );
      return {
        csv: buildCsv(
          ['Mã', 'Đã dùng', 'Giới hạn', 'Lô', 'Trạng thái'],
          rows.map((row) => [
            row.code,
            String(row.usedCount ?? 0),
            row.usageLimit === null ? '' : String(row.usageLimit),
            row.batch ?? '',
            row.active ? 'bật' : 'tắt',
          ]),
        ),
        fileName: `ma-khuyen-mai-${id}.csv`,
      };
    },

    /**
     * GET /promotions/targets — branches, products and categories the K2 picker offers, from the catalog
     * adapter (refs are what a cart line carries: `sellable.ref.uid` and category refs).
     */
    async targets(locale: string) {
      const cfg = strapi.config.get('plugin::ordering') as OrderingConfig;
      const adapter = (strapi.plugin('ordering').service('registry') as OrderingRegistry).catalogAdapter(
        cfg.catalog.adapter,
      );
      const products = new Map<string, { ref: string; title: string; categories: string[] }>();
      const categories = new Map<string, { ref: string; title: string }>();
      let cursor: string | undefined;
      for (let pageIndex = 0; pageIndex < 40; pageIndex += 1) {
        const { items, nextCursor } = await adapter.listSellables(
          { now: new Date().toISOString() },
          { locale: locale === 'en' ? 'en' : 'vi', limit: 50, ...(cursor ? { cursor } : {}) },
        );
        for (const item of items) {
          if (!products.has(item.ref.uid)) {
            products.set(item.ref.uid, {
              ref: item.ref.uid,
              title: item.title,
              categories: item.categories.map((category) => category.ref),
            });
          }
          for (const category of item.categories) {
            if (!categories.has(category.ref)) categories.set(category.ref, { ref: category.ref, title: category.title });
          }
        }
        if (!nextCursor) break;
        cursor = nextCursor;
      }
      const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, 'vi');
      const branches = (
        (await (strapi.plugin('ordering').service('branch') as { list(): Promise<Array<{ code: string; name: unknown; isActive: boolean }>> }).list())
      )
        .filter((row) => row.isActive)
        .map((row) => {
          const name = parseJson<Record<string, string>>(row.name, {});
          return { code: row.code, name: name[locale] ?? name.vi ?? row.code };
        });
      return {
        products: [...products.values()].sort(byTitle),
        categories: [...categories.values()].sort(byTitle),
        branches,
      };
    },

    /** GET /promotions/:id/redemptions — K4 orders that used it. */
    async redemptions(id: number, query: { page?: number }) {
      await find(id);
      const page = query.page ?? 1;
      const base = knex()
        .from('plugins_ordering_promotion_redemption as r')
        .join('plugins_ordering_order as o', 'o.id', 'r.order_id')
        .leftJoin('plugins_ordering_promotion_code as c', 'c.id', 'r.promotion_code_id')
        .where('r.promotion_id', id);
      const [{ total }] = (await base.clone().count({ total: '*' })) as Array<{ total: string | number }>;
      const rows = (await base
        .clone()
        .orderBy('r.id', 'desc')
        .offset((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .select(
          'r.id',
          'r.order_id',
          'o.code as order_code',
          'o.business_date',
          'o.location_ref',
          'c.code as promotion_code',
          'r.discount_amount',
          'r.status',
          'r.reserved_at',
        )) as Array<Record<string, unknown>>;
      return {
        items: rows.map((row) => ({
          id: Number(row.id),
          orderId: Number(row.order_id),
          orderCode: row.order_code,
          businessDate: row.business_date instanceof Date ? row.business_date.toISOString().slice(0, 10) : String(row.business_date).slice(0, 10),
          locationRef: row.location_ref,
          code: row.promotion_code ?? null,
          discountAmount: Number(row.discount_amount),
          status: row.status,
          reservedAt: row.reserved_at,
        })),
        pagination: { page, pageSize: PAGE_SIZE, total: Number(total) },
      };
    },
  };
};

/** The editable fields of a stored promotion (the change-log before-image of an update). */
const storedData = (row: Record<string, unknown>) =>
  Object.fromEntries(
    [
      'name', 'internalNote', 'discountType', 'value', 'maxDiscount', 'target', 'minSubtotal',
      'locationRefs', 'receiveKinds', 'startsAt', 'endsAt', 'weekdays', 'timeRanges',
      'firstOrderOnly', 'customerGroups', 'usageLimit', 'perCustomerLimit', 'stackable', 'priority', 'active',
    ].map((key) => [key, row[key]]),
  );

export default promotionAdmin;
