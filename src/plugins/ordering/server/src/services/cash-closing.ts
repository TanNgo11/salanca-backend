import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { businessDate } from '../domain/business-date';
import { OrderingError } from '../domain/errors';
import type { TransactionClient } from '../migrations/runner';
import type alertFactory from './alert';
import type { BranchRow } from './branch';
import type branchFactory from './branch';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';
import { actorRefOf, nowOf } from './context';
import type scopeFactory from './scope';

/**
 * End-of-day cash closing (O6 V3, contracts §19.3). Per (branch, business date, collector) the
 * service totals captured cash payments minus settled cash refunds, compares with the physical
 * count the manager enters, and records one `current` row per triple. Corrections never edit a
 * row — they append a revision and supersede the previous one. A nonzero difference opens the
 * `cash-closing-mismatch` alert; bringing a later revision to zero resolves it.
 */
type Services = {
  scope: ReturnType<typeof scopeFactory>;
  branch: ReturnType<typeof branchFactory>;
  alert: ReturnType<typeof alertFactory>;
  changeLog: ReturnType<typeof changeLogFactory>;
};

type CashClosingRow = {
  id: number;
  locationRef: string;
  businessDate: string;
  collectorRef: string;
  orderCount: number;
  systemAmount: number;
  refundAmount: number;
  expectedAmount: number;
  countedAmount: number;
  differenceAmount: number;
  note: string | null;
  closedBy: string;
  closedAt: string;
  status: string;
  revision: number;
  supersedesId: number | null;
  adjustmentReason: string | null;
};

export type ClosingSnapshot = {
  id: number;
  countedAmount: number;
  differenceAmount: number;
  note: string | null;
  closedBy: string;
  closedByName: string | null;
  closedAt: string;
  revision: number;
  adjustmentReason: string | null;
};

export type CollectorRow = {
  collectorRef: string;
  collectorName: string | null;
  orderCount: number;
  systemAmount: number;
  refundAmount: number;
  expectedAmount: number;
  closing: ClosingSnapshot | null;
};

export type CashClosingSummary = {
  branch: { code: string; name: Record<string, string>; timezone: string };
  businessDate: string;
  isToday: boolean;
  rows: CollectorRow[];
  totals: { orderCount: number; systemAmount: number; refundAmount: number; expectedAmount: number };
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SYSTEM_COLLECTOR = 'system';

/**
 * Stable advisory-lock key for one ledger bucket. `close` and every cash capture/refund
 * write on the same (branch, business date, collector) triple take this lock, so a closing
 * snapshot and a late posting serialize: the closing can never silently miss a later write,
 * and a write that arrives after the close opens a mismatch alert.
 */
export const cashBucketLockKey = (
  locationRef: string,
  businessDate: string,
  collectorRef: string,
): string => `cash-closing:${locationRef}:${businessDate}:${collectorRef}`;

const int = (value: string | number | null | undefined): number => {
  const n = Number(value ?? 0);
  if (!Number.isSafeInteger(n)) {
    throw new OrderingError('INTERNAL', 'cash amount is out of safe integer range');
  }
  return n;
};

const dateOf = (value: unknown): string => {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) {
    throw new OrderingError('VALIDATION_ERROR', 'businessDate must be YYYY-MM-DD', {
      details: { field: 'businessDate' },
    });
  }
  return value;
};

const amountOf = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new OrderingError('VALIDATION_ERROR', `${field} must be a non-negative integer`, {
      details: { field },
    });
  }
  return value;
};

const textOf = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  ((error as { code?: string }).code === '23505' ||
    (error as { cause?: { code?: string } }).cause?.code === '23505');

/**
 * PG `bigint`/`date` surface as strings; every row leaves the service with real numbers and a
 * `YYYY-MM-DD` date. Used for both db.query rows (camelCase) and raw knex rows via `fromDb`.
 */
const amounts = (row: CashClosingRow): CashClosingRow => ({
  ...row,
  orderCount: int(row.orderCount),
  systemAmount: int(row.systemAmount),
  refundAmount: int(row.refundAmount),
  expectedAmount: int(row.expectedAmount),
  countedAmount: int(row.countedAmount),
  differenceAmount: int(row.differenceAmount),
});

/** Raw knex rows are snake_case; db.query rows are camelCase attributes. Normalize both. */
const fromDb = (r: Record<string, unknown>): CashClosingRow =>
  amounts({
    id: Number(r.id),
    locationRef: String(r.location_ref),
    businessDate: String(r.business_date),
    collectorRef: String(r.collector_ref),
    orderCount: Number(r.order_count),
    systemAmount: r.system_amount as number,
    refundAmount: r.refund_amount as number,
    expectedAmount: r.expected_amount as number,
    countedAmount: r.counted_amount as number,
    differenceAmount: r.difference_amount as number,
    note: (r.note as string | null) ?? null,
    closedBy: String(r.closed_by),
    closedAt: r.closed_at instanceof Date ? r.closed_at.toISOString() : String(r.closed_at),
    status: String(r.status),
    revision: Number(r.revision),
    supersedesId:
      r.supersedes_id === null || r.supersedes_id === undefined ? null : Number(r.supersedes_id),
    adjustmentReason: (r.adjustment_reason as string | null) ?? null,
  });

/** `admin:<id>` → "First Last"; anything else resolves to null (same lookup as order detail). */
const adminNameMap = async (
  strapi: Core.Strapi,
  refs: string[],
): Promise<Map<string, string | null>> => {
  const ids = new Set<number>();
  for (const ref of refs) {
    const match = /^admin:(\d+)$/.exec(ref);
    if (match) ids.add(Number(match[1]));
  }
  const map = new Map<string, string | null>(refs.map((ref) => [ref, null]));
  if (ids.size === 0) return map;
  const users = (await strapi.db.query('admin::user').findMany({
    where: { id: { $in: [...ids] } },
    select: ['id', 'firstname', 'lastname'],
  })) as Array<{ id: number; firstname?: string | null; lastname?: string | null }>;
  for (const user of users) {
    map.set(
      `admin:${user.id}`,
      [user.firstname, user.lastname].filter(Boolean).join(' ') || null,
    );
  }
  return map;
};

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const services = (): Services => ({
    scope: strapi.plugin('ordering').service('scope') as Services['scope'],
    branch: strapi.plugin('ordering').service('branch') as Services['branch'],
    alert: strapi.plugin('ordering').service('alert') as Services['alert'],
    changeLog: strapi.plugin('ordering').service('change-log') as Services['changeLog'],
  });
  const closings = () => strapi.db.query('plugin::ordering.cash-closing');
  const knex = () => strapi.db.connection;

  const requireBranch = async (locationRef: string, ctx: ServiceContext): Promise<BranchRow> => {
    const { scope, branch } = services();
    const staffScope = await scope.loadScope(ctx);
    scope.assertLocationInScope(staffScope, locationRef);
    const row = await branch.findByCode(locationRef);
    if (!row) {
      throw new OrderingError('BRANCH_NOT_FOUND', 'branch not found');
    }
    return row;
  };

  const cutoffOf = (row: BranchRow): string =>
    services().branch.pickupSettings(row).schedule.businessDayPolicy.cutoffLocalTime ??
    (strapi.config.get('plugin::ordering') as OrderingConfig).businessDay.cutoffLocalTime;

  /** Captured cash per collector for the branch/day — `actor_ref` null groups as 'system'. */
  const paymentBuckets = async (
    locationRef: string,
    day: string,
    q: TransactionClient = knex(),
  ): Promise<Map<string, { orderCount: number; systemAmount: number }>> => {
    const rows = (await q
      .from('plugins_ordering_payment as p')
      .join('plugins_ordering_payment_order_lnk as link', 'link.payment_id', 'p.id')
      .join('plugins_ordering_order as o', 'o.id', 'link.order_id')
      .where('o.location_ref', locationRef)
      .where('p.provider_code', 'cash')
      .where('p.status', 'captured')
      .where('p.business_date', day)
      .groupBy('p.actor_ref')
      .select('p.actor_ref')
      .select(knex().raw('count(distinct link.order_id) as order_count'))
      .select(knex().raw('coalesce(sum(p.captured_amount), 0) as system_amount'))) as Array<{
      actor_ref: string | null;
      order_count: string | number;
      system_amount: string | number;
    }>;
    const map = new Map<string, { orderCount: number; systemAmount: number }>();
    for (const row of rows) {
      map.set(row.actor_ref ?? SYSTEM_COLLECTOR, {
        orderCount: Number(row.order_count),
        systemAmount: int(row.system_amount),
      });
    }
    return map;
  };

  /**
   * Settled cash refunds for the branch/day (positive amounts), charged to the collector of the
   * refunded payment — the cash left that person's float, whoever pressed "hoàn tiền".
   */
  const refundBuckets = async (
    locationRef: string,
    day: string,
    q: TransactionClient = knex(),
  ): Promise<Map<string, number>> => {
    const rows = (await q
      .from('plugins_ordering_refund as r')
      .join('plugins_ordering_refund_order_lnk as orl', 'orl.refund_id', 'r.id')
      .join('plugins_ordering_order as o', 'o.id', 'orl.order_id')
      .join('plugins_ordering_refund_payment_lnk as prl', 'prl.refund_id', 'r.id')
      .join('plugins_ordering_payment as p', 'p.id', 'prl.payment_id')
      .where('o.location_ref', locationRef)
      .where('r.status', 'settled')
      .where('r.business_date', day)
      .where('p.provider_code', 'cash')
      .groupBy('p.actor_ref')
      .select('p.actor_ref')
      .select(knex().raw('coalesce(sum(r.amount), 0) as refund_amount'))) as Array<{
      actor_ref: string | null;
      refund_amount: string | number;
    }>;
    const map = new Map<string, number>();
    for (const row of rows) {
      map.set(row.actor_ref ?? SYSTEM_COLLECTOR, int(row.refund_amount));
    }
    return map;
  };

  const currentClosings = async (
    locationRef: string,
    day: string,
  ): Promise<CashClosingRow[]> =>
    (
      (await closings().findMany({
        where: { locationRef, businessDate: day, status: 'current' },
      })) as CashClosingRow[]
    ).map(amounts);

  const snapshot = (row: CashClosingRow, names: Map<string, string | null>): ClosingSnapshot => ({
    id: row.id,
    countedAmount: int(row.countedAmount),
    differenceAmount: int(row.differenceAmount),
    note: row.note,
    closedBy: row.closedBy,
    closedByName: names.get(row.closedBy) ?? null,
    closedAt: row.closedAt,
    revision: row.revision,
    adjustmentReason: row.adjustmentReason,
  });

  /** Collector-shaped row as returned by `summary`, also used in close/adjust responses. */
  const collectorRow = (
    collectorRef: string,
    bucket: { orderCount: number; systemAmount: number; refundAmount: number },
    closing: CashClosingRow | null,
    names: Map<string, string | null>,
  ): CollectorRow => ({
    collectorRef,
    collectorName: names.get(collectorRef) ?? null,
    orderCount: bucket.orderCount,
    systemAmount: bucket.systemAmount,
    refundAmount: bucket.refundAmount,
    expectedAmount: bucket.systemAmount - bucket.refundAmount,
    closing: closing ? snapshot(closing, names) : null,
  });

  const dedupeKey = (locationRef: string, day: string, collectorRef: string): string =>
    `cash-closing-mismatch:${locationRef}:${day}:${collectorRef}`;

  /** Fresh system totals for one collector; used by close/adjust — never trust client numbers. */
  const collectorBucket = async (
    locationRef: string,
    day: string,
    collectorRef: string,
    q: TransactionClient = knex(),
  ): Promise<{ orderCount: number; systemAmount: number; refundAmount: number }> => {
    const payments = await paymentBuckets(locationRef, day, q);
    const refunds = await refundBuckets(locationRef, day, q);
    return {
      orderCount: payments.get(collectorRef)?.orderCount ?? 0,
      systemAmount: payments.get(collectorRef)?.systemAmount ?? 0,
      refundAmount: refunds.get(collectorRef) ?? 0,
    };
  };

  const reportMismatch = async (
    row: CashClosingRow,
    ctx: ServiceContext,
  ): Promise<void> => {
    await services().alert.open(
      {
        alertCode: 'cash-closing-mismatch',
        dedupeKey: dedupeKey(row.locationRef, row.businessDate, row.collectorRef),
        severity: 'warning',
        locationRef: row.locationRef,
        aggregateRef: `cash-closing:${row.id}`,
      },
      ctx,
    );
  };

  return {
    /** Branch/day summary for the V3 screen — collectors, system totals, current closings. */
    async summary(locationRef: string, day: string, ctx: ServiceContext): Promise<CashClosingSummary> {
      const requestedDay = dateOf(day);
      const branchRow = await requireBranch(locationRef, ctx);
      const [payments, refunds, closed] = await Promise.all([
        paymentBuckets(locationRef, requestedDay),
        refundBuckets(locationRef, requestedDay),
        currentClosings(locationRef, requestedDay),
      ]);
      const collectorRefs = new Set<string>([
        ...payments.keys(),
        ...refunds.keys(),
        ...closed.map((row) => row.collectorRef),
      ]);
      const byClosingCollector = new Map(closed.map((row) => [row.collectorRef, row]));
      const names = await adminNameMap(strapi, [
        ...collectorRefs,
        ...closed.map((row) => row.closedBy),
      ]);
      const rows: CollectorRow[] = [...collectorRefs].map((collectorRef) =>
        collectorRow(
          collectorRef,
          {
            orderCount: payments.get(collectorRef)?.orderCount ?? 0,
            systemAmount: payments.get(collectorRef)?.systemAmount ?? 0,
            refundAmount: refunds.get(collectorRef) ?? 0,
          },
          byClosingCollector.get(collectorRef) ?? null,
          names,
        ),
      );
      rows.sort((a, b) => a.collectorRef.localeCompare(b.collectorRef));
      const totals = rows.reduce(
        (acc, row) => ({
          orderCount: acc.orderCount + row.orderCount,
          systemAmount: acc.systemAmount + row.systemAmount,
          refundAmount: acc.refundAmount + row.refundAmount,
          expectedAmount: acc.expectedAmount + row.expectedAmount,
        }),
        { orderCount: 0, systemAmount: 0, refundAmount: 0, expectedAmount: 0 },
      );
      return {
        branch: { code: branchRow.code, name: branchRow.name ?? {}, timezone: branchRow.timezone },
        businessDate: requestedDay,
        isToday:
          requestedDay === businessDate(nowOf(ctx), branchRow.timezone, cutoffOf(branchRow)),
        rows,
        totals,
      };
    },

    /** Branches visible to the caller with their current business date (V3/V4 pickers). */
    async reportBranches(ctx: ServiceContext) {
      const { scope, branch } = services();
      const staffScope = await scope.loadScope(ctx);
      if (staffScope === null) {
        throw new OrderingError('SCOPE_REQUIRED', 'staff member has no location scope');
      }
      const rows = await branch.list();
      const visible = rows.filter(
        (row) =>
          row.isActive && (staffScope.allLocations || staffScope.locationRefs.includes(row.code)),
      );
      return {
        branches: visible.map((row) => ({
          code: row.code,
          name: row.name ?? {},
          timezone: row.timezone,
          businessDateToday: businessDate(nowOf(ctx), row.timezone, cutoffOf(row)),
        })),
      };
    },

    /**
     * Call inside the caller's transaction BEFORE any cash capture/refund write. Takes the
     * ledger-bucket advisory lock so the write serializes against `close` on the same
     * (branch, business date, collector): the closing snapshot either includes the write or the
     * write lands after it. A write after a `current` closing is NOT rejected — a refund or
     * handover must still go through — but it opens the `cash-closing-mismatch` alert so a
     * closing that no longer matches the ledger is never silent. `adjust` recomputes the
     * expected amount from the ledger and resolves the alert once the count matches again.
     */
    async noteCashPosting(
      trx: TransactionClient,
      locationRef: string,
      businessDate: string,
      collectorRef: string,
      ctx: ServiceContext,
    ): Promise<void> {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
        cashBucketLockKey(locationRef, businessDate, collectorRef),
      ]);
      const closed = (await closings().findOne({
        where: { locationRef, businessDate, collectorRef, status: 'current' },
      })) as CashClosingRow | null;
      if (closed) {
        await reportMismatch(closed, ctx);
      }
    },

    /**
     * Close one collector's day. System totals are recomputed server-side; a second `current`
     * row for the same triple is rejected — both by a pre-check and the partial unique index
     * (23505 → CASH_CLOSING_EXISTS) so simultaneous closes are safe.
     */
    async close(
      input: {
        locationRef: string;
        businessDate: string;
        collectorRef: string;
        countedAmount: number;
        note?: string | null;
      },
      ctx: ServiceContext,
    ): Promise<{ closing: CashClosingRow; row: CollectorRow }> {
      const day = dateOf(input.businessDate);
      const counted = amountOf(input.countedAmount, 'countedAmount');
      const note = textOf(input.note);
      const collectorRef = textOf(input.collectorRef);
      if (!collectorRef) {
        throw new OrderingError('VALIDATION_ERROR', 'collectorRef is required', {
          details: { field: 'collectorRef' },
        });
      }
      await requireBranch(input.locationRef, ctx);
      // The snapshot is taken under the same advisory lock every cash capture/refund takes, so a
      // closing is either before all postings or after all of them — never racing one. Cash that
      // lands after the closing opens a mismatch alert via `noteCashPosting`.
      const { bucket, closing } = await strapi.db.transaction(
        async ({ trx }: { trx: TransactionClient }) => {
          await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
            cashBucketLockKey(input.locationRef, day, collectorRef),
          ]);
          const bucket = await collectorBucket(input.locationRef, day, collectorRef, trx);
          const expectedAmount = bucket.systemAmount - bucket.refundAmount;
          const differenceAmount = counted - expectedAmount;
          if (differenceAmount !== 0 && !note) {
            throw new OrderingError('VALIDATION_ERROR', 'a note is required when the count differs', {
              details: { field: 'note' },
            });
          }
          const existing = (await closings().findOne({
            where: {
              locationRef: input.locationRef,
              businessDate: day,
              collectorRef,
              status: 'current',
            },
          })) as CashClosingRow | null;
          if (existing) {
            throw new OrderingError('CASH_CLOSING_EXISTS', 'collector is already closed for this day');
          }
          let closing: CashClosingRow;
          try {
            closing = amounts((await closings().create({
              data: {
                locationRef: input.locationRef,
                businessDate: day,
                collectorRef,
                orderCount: bucket.orderCount,
                systemAmount: bucket.systemAmount,
                refundAmount: bucket.refundAmount,
                expectedAmount,
                countedAmount: counted,
                differenceAmount,
                note,
                closedBy: actorRefOf(ctx),
                closedAt: nowOf(ctx),
                status: 'current',
                revision: 1,
              },
            })) as CashClosingRow);
          } catch (error) {
            if (isUniqueViolation(error)) {
              throw new OrderingError(
                'CASH_CLOSING_EXISTS',
                'collector is already closed for this day',
              );
            }
            throw error;
          }
          return { bucket, closing };
        },
      );
      if (int(closing.differenceAmount) !== 0) {
        await reportMismatch(closing, ctx);
      }
      await services().changeLog.record(
        {
          action: 'cash-closing.close',
          entityType: 'cash-closing',
          entityId: String(closing.id),
          locationRef: input.locationRef,
          after: closing as unknown as Record<string, unknown>,
        },
        ctx,
      );
      const names = await adminNameMap(strapi, [collectorRef, closing.closedBy]);
      return { closing, row: collectorRow(collectorRef, bucket, closing, names) };
    },

    /**
     * Correct a closed day: the old row becomes `superseded` and a new revision with a required
     * reason becomes `current` — history is preserved. Zero difference resolves the alert.
     */
    async adjust(
      id: number,
      input: { countedAmount: number; note?: string | null; reason?: string | null },
      ctx: ServiceContext,
    ): Promise<{ closing: CashClosingRow; row: CollectorRow }> {
      const counted = amountOf(input.countedAmount, 'countedAmount');
      const note = textOf(input.note);
      const reason = textOf(input.reason);
      if (!reason) {
        throw new OrderingError('VALIDATION_ERROR', 'an adjustment reason is required', {
          details: { field: 'reason' },
        });
      }
      const result = await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
        const locked = await trx('plugins_ordering_cash_closing')
          .where({ id })
          .forUpdate()
          .first();
        if (!locked) {
          throw new OrderingError('CASH_CLOSING_NOT_FOUND', 'closing not found');
        }
        const previous = fromDb(locked as Record<string, unknown>);
        // Out-of-scope answers as "not found" — the caller must not learn the row exists.
        try {
          services().scope.assertLocationInScope(
            await services().scope.loadScope(ctx),
            previous.locationRef,
          );
        } catch {
          throw new OrderingError('CASH_CLOSING_NOT_FOUND', 'closing not found');
        }
        if (previous.status !== 'current') {
          throw new OrderingError('INVALID_TRANSITION', 'only the current closing can be adjusted');
        }
        // Same bucket lock as `close` and every cash posting: the recomputed ledger either
        // includes an in-flight capture or that capture lands after this revision and opens the
        // alert — never a revision computed from a ledger a parked capture is about to change.
        await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [
          cashBucketLockKey(previous.locationRef, previous.businessDate, previous.collectorRef),
        ]);
        const bucket = await collectorBucket(
          previous.locationRef,
          previous.businessDate,
          previous.collectorRef,
          trx,
        );
        const expectedAmount = bucket.systemAmount - bucket.refundAmount;
        const differenceAmount = counted - expectedAmount;
        if (differenceAmount !== 0 && !note) {
          throw new OrderingError(
            'VALIDATION_ERROR',
            'a note is required when the count differs',
            { details: { field: 'note' } },
          );
        }
        await trx('plugins_ordering_cash_closing')
          .where({ id: previous.id })
          .update({ status: 'superseded' });
        let closing: CashClosingRow;
        try {
          const [created] = await trx('plugins_ordering_cash_closing')
            .insert({
              location_ref: previous.locationRef,
              business_date: previous.businessDate,
              collector_ref: previous.collectorRef,
              order_count: bucket.orderCount,
              system_amount: bucket.systemAmount,
              refund_amount: bucket.refundAmount,
              expected_amount: expectedAmount,
              counted_amount: counted,
              difference_amount: differenceAmount,
              note: note ?? previous.note,
              closed_by: actorRefOf(ctx),
              closed_at: nowOf(ctx),
              status: 'current',
              revision: previous.revision + 1,
              supersedes_id: previous.id,
              adjustment_reason: reason,
            })
            .returning('*');
          closing = fromDb(created as Record<string, unknown>);
        } catch (error) {
          if (isUniqueViolation(error)) {
            throw new OrderingError(
              'CASH_CLOSING_EXISTS',
              'collector is already closed for this day',
            );
          }
          throw error;
        }
        return { previous, closing, bucket };
      });
      const { previous, closing, bucket } = result;
      if (int(closing.differenceAmount) !== 0) {
        await reportMismatch(closing, ctx);
      } else {
        await services().alert.resolve(
          dedupeKey(closing.locationRef, closing.businessDate, closing.collectorRef),
          ctx,
        );
      }
      await services().changeLog.record(
        {
          action: 'cash-closing.adjust',
          entityType: 'cash-closing',
          entityId: String(closing.id),
          locationRef: closing.locationRef,
          before: previous as unknown as Record<string, unknown>,
          after: closing as unknown as Record<string, unknown>,
        },
        ctx,
      );
      const names = await adminNameMap(strapi, [closing.collectorRef, closing.closedBy]);
      return {
        closing,
        row: collectorRow(closing.collectorRef, bucket, closing, names),
      };
    },
  };
};
