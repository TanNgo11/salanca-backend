import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import type { BranchRow } from './branch';
import type branchFactory from './branch';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type scopeFactory from './scope';

/**
 * Sales report (O6 V4). Revenue and refunds are read from the ledgers (`payment` captured,
 * `refund` settled — money actually moved, regardless of order status); "sold orders" are
 * open/completed orders by business date. Category/product groupings read the order-line
 * snapshots only — never the live catalog — so renamed items keep the name at order time.
 * Every day-group revenue column sums back to the ledger total.
 */
type Services = {
  scope: ReturnType<typeof scopeFactory>;
  branch: ReturnType<typeof branchFactory>;
};

export type ReportGroupBy = 'day' | 'category' | 'product' | 'payment' | 'receive' | 'promotion';
export type ReportRow = {
  key: string;
  label: string;
  orders: number;
  quantity?: number;
  gross?: number;
  revenue?: number;
  refunded?: number;
  /** O8: positive VND taken off by this promotion (from order adjustments). */
  discount?: number;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const GROUPINGS = ['day', 'category', 'product', 'payment', 'receive', 'promotion'] as const;
const SOLD_STATUSES = ['open', 'completed'];
const MAX_RANGE_DAYS = 366;
const UNCATEGORIZED = { key: 'uncategorized', label: 'Không có danh mục' };

const int = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) {
    throw new OrderingError('INTERNAL', 'report amount is out of safe integer range');
  }
  return n;
};

const dayOf = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new OrderingError('VALIDATION_ERROR', `${field} must be YYYY-MM-DD`, {
      details: { field },
    });
  }
  return value;
};

const daySpan = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);

type CategorySnapshot = { ref?: unknown; title?: unknown };

/** JSON columns arrive parsed (jsonb) or as raw text depending on the driver path. */
const firstCategory = (snapshot: unknown): { ref: string; title: string } | null => {
  let list = snapshot;
  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch {
      return null;
    }
  }
  const first = Array.isArray(list) ? (list[0] as CategorySnapshot | undefined) : undefined;
  if (!first || typeof first.ref !== 'string' || first.ref === '') return null;
  return { ref: first.ref, title: typeof first.title === 'string' ? first.title : first.ref };
};

const dateText = (value: unknown): string =>
  value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => ({
    scope: strapi.plugin('ordering').service('scope') as Services['scope'],
    branch: strapi.plugin('ordering').service('branch') as Services['branch'],
  });
  const knex = () => strapi.db.connection;

  const scopedLocations = async (
    branchCode: string | undefined,
    ctx: ServiceContext,
  ): Promise<{ locations: string[] | null; branch: BranchRow | null }> => {
    const { scope, branch } = services();
    const staffScope = await scope.loadScope(ctx);
    if (staffScope === null) {
      throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
    }
    if (branchCode !== undefined && branchCode !== '') {
      scope.assertLocationInScope(staffScope, branchCode);
      const row = await branch.findByCode(branchCode);
      if (!row) {
        throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found');
      }
      return { locations: [branchCode], branch: row };
    }
    return {
      locations: staffScope.allLocations ? null : [...staffScope.locationRefs],
      branch: null,
    };
  };

  type Aggregates = {
    byDate: Map<string, { orders: number; gross: number; revenue: number; refunded: number }>;
    byProvider: Map<string, { orders: Set<number>; revenue: number; refunded: number }>;
    byReceive: Map<string, { orders: number; gross: number }>;
    lines: Array<{
      orderId: number;
      sellableUid: string;
      variantUid: string | null;
      title: string;
      category: { ref: string; title: string } | null;
      quantity: number;
      gross: number;
    }>;
    /** O8: one row per promotion adjustment on a sold order (`sourceRef` promotion:<id>). */
    promotions: Map<string, { label: string; orders: Set<number>; discount: number; gross: number }>;
    summary: {
      orders: number;
      gross: number;
      revenue: number;
      refunded: number;
      /** Positive VND of every `discount` adjustment on sold orders (promotions and staff). */
      discount: number;
    };
  };

  /** One pass over the three sources (sold orders, payment ledger, refund ledger). */
  const collect = async (
    from: string,
    to: string,
    locations: string[] | null,
  ): Promise<Aggregates> => {
    const orders = knex()
      .from('plugins_ordering_order as o')
      .whereIn('o.status', SOLD_STATUSES)
      .whereBetween('o.business_date', [from, to]);
    if (locations !== null) orders.whereIn('o.location_ref', locations);
    const orderRows = (await orders
      .select('o.id', 'o.business_date', 'o.total_amount')
      .select(knex().raw(`o.receive_method ->> 'kind' as receive_kind`))) as Array<{
      id: number;
      business_date: string | Date;
      total_amount: string | number;
      receive_kind: string | null;
    }>;

    const payments = knex()
      .from('plugins_ordering_payment as p')
      .join('plugins_ordering_payment_order_lnk as link', 'link.payment_id', 'p.id')
      .join('plugins_ordering_order as o', 'o.id', 'link.order_id')
      .where('p.status', 'captured')
      .whereBetween('p.business_date', [from, to]);
    if (locations !== null) payments.whereIn('o.location_ref', locations);
    const paymentRows = (await payments
      .groupBy('p.provider_code', 'p.business_date')
      .select('p.provider_code', 'p.business_date')
      .select(knex().raw('coalesce(sum(p.captured_amount), 0) as captured'))
      // Distinct orders per provider span days — collect ids and dedupe in JS.
      .select(knex().raw('array_agg(distinct link.order_id) as order_ids'))) as Array<{
      provider_code: string;
      business_date: string | Date;
      captured: string | number;
      order_ids: Array<number | string> | null;
    }>;

    const refunds = knex()
      .from('plugins_ordering_refund as r')
      .join('plugins_ordering_refund_order_lnk as orl', 'orl.refund_id', 'r.id')
      .join('plugins_ordering_order as o', 'o.id', 'orl.order_id')
      .leftJoin('plugins_ordering_refund_payment_lnk as prl', 'prl.refund_id', 'r.id')
      .leftJoin('plugins_ordering_payment as p', 'p.id', 'prl.payment_id')
      .where('r.status', 'settled')
      .whereBetween('r.business_date', [from, to]);
    if (locations !== null) refunds.whereIn('o.location_ref', locations);
    const refundRows = (await refunds
      .groupBy('p.provider_code', 'r.business_date')
      .select('p.provider_code', 'r.business_date')
      .select(knex().raw('coalesce(sum(r.amount), 0) as refunded'))) as Array<{
      provider_code: string | null;
      business_date: string | Date;
      refunded: string | number;
    }>;

    const lines = knex()
      .from('plugins_ordering_order_line as ol')
      .join('plugins_ordering_order_line_order_lnk as link', 'link.order_line_id', 'ol.id')
      .join('plugins_ordering_order as o', 'o.id', 'link.order_id')
      .whereIn('o.status', SOLD_STATUSES)
      .whereBetween('o.business_date', [from, to]);
    if (locations !== null) lines.whereIn('o.location_ref', locations);
    const lineRows = (await lines.select(
      'link.order_id',
      'ol.sellable_uid',
      'ol.variant_uid',
      'ol.title_snapshot',
      'ol.categories_snapshot',
      'ol.quantity',
      'ol.canceled_quantity',
      'ol.line_total_amount',
    )) as Array<{
      order_id: number;
      sellable_uid: string;
      variant_uid: string | null;
      title_snapshot: string;
      categories_snapshot: unknown;
      quantity: number;
      canceled_quantity: number;
      line_total_amount: string | number;
    }>;

    // O8: discounts read from the order's own adjustments — an order edit reprices them, while
    // `promotion-redemption.discountAmount` keeps the amount at reservation time.
    const adjustments = knex()
      .from('plugins_ordering_order_adjustment as a')
      .join('plugins_ordering_order_adjustment_order_lnk as link', 'link.order_adjustment_id', 'a.id')
      .join('plugins_ordering_order as o', 'o.id', 'link.order_id')
      .where('a.kind', 'discount')
      .whereIn('o.status', SOLD_STATUSES)
      .whereBetween('o.business_date', [from, to]);
    if (locations !== null) adjustments.whereIn('o.location_ref', locations);
    const adjustmentRows = (await adjustments.select(
      'link.order_id',
      'a.code',
      'a.label',
      'a.source_ref',
      'a.amount',
      'o.total_amount',
    )) as Array<{
      order_id: number;
      code: string;
      label: string;
      source_ref: string | null;
      amount: string | number;
      total_amount: string | number;
    }>;
    const promotions = new Map<
      string,
      { label: string; orders: Set<number>; discount: number; gross: number }
    >();
    let discount = 0;
    for (const row of adjustmentRows) {
      const amount = -int(row.amount);
      discount += amount;
      if (!row.source_ref?.startsWith('promotion:')) continue;
      const group = promotions.get(row.source_ref) ?? {
        label: row.label || row.code,
        orders: new Set<number>(),
        discount: 0,
        gross: 0,
      };
      const orderId = Number(row.order_id);
      if (!group.orders.has(orderId)) group.gross += int(row.total_amount);
      group.orders.add(orderId);
      group.discount += amount;
      promotions.set(row.source_ref, group);
    }

    const byDate = new Map<
      string,
      { orders: number; gross: number; revenue: number; refunded: number }
    >();
    const byProvider = new Map<
      string,
      { orders: Set<number>; revenue: number; refunded: number }
    >();
    const byReceive = new Map<string, { orders: number; gross: number }>();
    const bucket = (day: string) => {
      const existing = byDate.get(day);
      if (existing) return existing;
      const created = { orders: 0, gross: 0, revenue: 0, refunded: 0 };
      byDate.set(day, created);
      return created;
    };

    for (const row of orderRows) {
      const gross = int(row.total_amount);
      const day = bucket(dateText(row.business_date));
      day.orders += 1;
      day.gross += gross;
      const kind = row.receive_kind ?? 'unknown';
      const receive = byReceive.get(kind) ?? { orders: 0, gross: 0 };
      receive.orders += 1;
      receive.gross += gross;
      byReceive.set(kind, receive);
    }
    for (const row of paymentRows) {
      const captured = int(row.captured);
      bucket(dateText(row.business_date)).revenue += captured;
      const provider = byProvider.get(row.provider_code) ?? {
        orders: new Set<number>(),
        revenue: 0,
        refunded: 0,
      };
      provider.revenue += captured;
      for (const id of row.order_ids ?? []) provider.orders.add(Number(id));
      byProvider.set(row.provider_code, provider);
    }
    for (const row of refundRows) {
      const refunded = int(row.refunded);
      bucket(dateText(row.business_date)).refunded += refunded;
      if (row.provider_code !== null) {
        const provider = byProvider.get(row.provider_code) ?? {
          orders: new Set<number>(),
          revenue: 0,
          refunded: 0,
        };
        provider.refunded += refunded;
        byProvider.set(row.provider_code, provider);
      }
    }

    const normalizedLines = lineRows.map((row) => {
      const quantity = Number(row.quantity ?? 0);
      const live = quantity - Number(row.canceled_quantity ?? 0);
      return {
        orderId: Number(row.order_id),
        sellableUid: row.sellable_uid,
        variantUid: row.variant_uid ?? null,
        title: row.title_snapshot,
        category: firstCategory(row.categories_snapshot),
        quantity: live,
        gross: quantity > 0 ? Math.round((int(row.line_total_amount) * live) / quantity) : 0,
      };
    });

    let revenue = 0;
    let refunded = 0;
    for (const day of byDate.values()) {
      revenue += day.revenue;
      refunded += day.refunded;
    }
    return {
      byDate,
      byProvider,
      byReceive,
      lines: normalizedLines,
      promotions,
      summary: {
        discount,
        orders: orderRows.length,
        gross: orderRows.reduce((sum, row) => sum + int(row.total_amount), 0),
        revenue,
        refunded,
      },
    };
  };

  const rowsFor = (groupBy: ReportGroupBy, data: Aggregates): ReportRow[] => {
    switch (groupBy) {
      case 'day':
        return [...data.byDate.entries()]
          .map(([key, day]) => ({ key, label: key, ...day }))
          .sort((a, b) => a.key.localeCompare(b.key));
      case 'payment':
        return [...data.byProvider.entries()]
          .map(([key, bucket]) => ({
            key,
            label: key,
            orders: bucket.orders.size,
            revenue: bucket.revenue,
            refunded: bucket.refunded,
          }))
          .sort((a, b) => b.revenue - a.revenue);
      case 'receive':
        return [...data.byReceive.entries()]
          .map(([key, bucket]) => ({ key, label: key, ...bucket }))
          .sort((a, b) => b.gross - a.gross);
      case 'promotion':
        return [...data.promotions.entries()]
          .map(([key, bucket]) => ({
            key,
            label: bucket.label,
            orders: bucket.orders.size,
            gross: bucket.gross,
            discount: bucket.discount,
          }))
          .sort((a, b) => b.discount - a.discount);
      case 'category':
      case 'product': {
        const groups = new Map<
          string,
          { label: string; seenAt: number; orders: Set<number>; quantity: number; gross: number }
        >();
        let seen = 0;
        for (const line of data.lines) {
          seen += 1;
          const key =
            groupBy === 'category'
              ? (line.category?.ref ?? UNCATEGORIZED.key)
              : line.variantUid
                ? `${line.sellableUid}|${line.variantUid}`
                : line.sellableUid;
          const label =
            groupBy === 'category' ? (line.category?.title ?? UNCATEGORIZED.label) : line.title;
          const bucket = groups.get(key) ?? {
            label,
            seenAt: seen,
            orders: new Set<number>(),
            quantity: 0,
            gross: 0,
          };
          // The latest occurrence wins the label — the snapshot title can evolve over time.
          if (seen > bucket.seenAt) {
            bucket.label = label;
            bucket.seenAt = seen;
          }
          bucket.orders.add(line.orderId);
          bucket.quantity += line.quantity;
          bucket.gross += line.gross;
          groups.set(key, bucket);
        }
        return [...groups.entries()]
          .map(([key, bucket]) => ({
            key,
            label: bucket.label,
            orders: bucket.orders.size,
            quantity: bucket.quantity,
            gross: bucket.gross,
          }))
          .sort((a, b) => b.gross - a.gross);
      }
    }
  };

  return {
    async sales(
      query: { branch?: string; from?: string; to?: string; groupBy?: string },
      ctx: ServiceContext,
    ) {
      const from = dayOf(query.from, 'from');
      const to = dayOf(query.to, 'to');
      if (from > to || daySpan(from, to) > MAX_RANGE_DAYS) {
        throw new OrderingError('VALIDATION_ERROR', 'report range is invalid (max 366 days)', {
          details: { field: 'to' },
        });
      }
      const groupBy = (query.groupBy ?? 'day') as ReportGroupBy;
      if (!GROUPINGS.includes(groupBy)) {
        throw new OrderingError('VALIDATION_ERROR', 'groupBy must be a supported grouping', {
          details: { field: 'groupBy' },
        });
      }
      const { locations, branch } = await scopedLocations(query.branch, ctx);
      const data = await collect(from, to, locations);
      const { orders, gross, revenue, refunded, discount } = data.summary;
      return {
        range: { from, to },
        branch: branch?.code ?? null,
        groupBy,
        summary: {
          revenue,
          refunded,
          orders,
          gross,
          averageOrder: orders > 0 ? Math.round(gross / orders) : 0,
          net: revenue - refunded,
          discount,
        },
        rows: rowsFor(groupBy, data),
        generatedAt: nowOf(ctx).toISOString(),
      };
    },
  };
};
