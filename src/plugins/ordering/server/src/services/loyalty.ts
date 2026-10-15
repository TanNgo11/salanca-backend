import type { Core } from '@strapi/strapi';

import { amountFromDb } from '../domain/money';
import { capDailyEarn, earnBase, earnPoints, localDayBounds } from '../domain/loyalty/earn';
import {
  addMonths,
  lotRemainingAfterDebt,
  takeFromLots,
  type Lot,
} from '../domain/loyalty/lots';
import { reversalTarget } from '../domain/loyalty/reverse';
import { decideTier, pickTier } from '../domain/loyalty/tier';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import { lockCustomer } from './customer-lock';
import type loyaltySettingsFactory from './loyalty-settings';
import type loyaltyTierFactory from './loyalty-tier';

const LOT = 'plugin::ordering.loyalty-lot';
const LEDGER = 'plugin::ordering.loyalty-ledger';
const LEDGER_TABLE = 'plugins_ordering_loyalty_ledger';
const LOT_TABLE = 'plugins_ordering_loyalty_lot';
const CUSTOMER_TABLE = 'plugins_ordering_customer';

export type LedgerKind =
  | 'earn'
  | 'redeem'
  | 'release'
  | 'reverse'
  | 'expire'
  | 'adjust'
  | 'history'
  | 'forfeit';

export type LedgerEntry = {
  customerId: number;
  kind: LedgerKind;
  points: number;
  baseAmount?: number | null;
  orderId?: number | null;
  lotId?: number | null;
  actorRef?: string | null;
  reason?: string | null;
  at: Date;
};

export type EarnOutcome =
  | { status: 'earned'; points: number; base: number; capped: boolean }
  | { status: 'skipped'; reason: string };

type OrderHead = {
  id: number;
  status: string;
  completed_at: Date | string | null;
  receive_method: unknown;
  customer_id: number | string | null;
};

type LotRow = { id: number; remaining: number; expires_at: Date | string };

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

/**
 * Loyalty core (O16): earn, reverse (and, in later steps, redeem/release/expire/adjust). Every point
 * change goes through `post`, which appends one ledger row and moves `customer.pointsBalance` in
 * the same transaction, under the customer lock. Lock order everywhere: order mutex → other row
 * locks (payment, line, group) → customer → lots. Callers that already hold a transaction pass it in;
 * the standalone entry points open their own.
 */
const loyalty = ({ strapi }: { strapi: Core.Strapi }) => {
  const repo = orderRepository({ strapi });
  const lots = () => strapi.db.query(LOT);
  const ledger = () => strapi.db.query(LEDGER);
  const settings = () => strapi.plugin('ordering').service('loyalty-settings') as ReturnType<typeof loyaltySettingsFactory>;
  const tierService = () => strapi.plugin('ordering').service('loyalty-tier') as ReturnType<typeof loyaltyTierFactory>;

  /** Row lock on the customer (same identity lock as linking and erasure), by id. Null for erased or missing. */
  const lockCustomerById = async (
    trx: TransactionClient,
    customerId: number,
  ): Promise<{ id: number; status: string; tierCode: string | null; belowSince: Date | null } | null> => {
    const head = (await trx(CUSTOMER_TABLE).where({ id: customerId }).first('id', 'phone_hash')) as
      | { id: number; phone_hash: string | null }
      | undefined;
    if (!head) return null;
    await lockCustomer(trx, { id: head.id, phoneHash: head.phone_hash });
    const row = (await trx(CUSTOMER_TABLE)
      .where({ id: customerId })
      .first('id', 'status', 'tier_code', 'tier_below_since')) as
      | { id: number; status: string; tier_code: string | null; tier_below_since: Date | null }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      status: row.status,
      tierCode: row.tier_code,
      belowSince: row.tier_below_since ? new Date(row.tier_below_since) : null,
    };
  };

  /**
   * Appends a ledger row and applies it to the customer's balance and 12-month spend cache. The
   * customer row must already be locked. Returns the balance after the row.
   */
  const post = async (trx: TransactionClient, entry: LedgerEntry): Promise<number> => {
    const row = (await trx(CUSTOMER_TABLE)
      .where({ id: entry.customerId })
      .first('points_balance', 'spend_12_m')) as { points_balance: number; spend_12_m: string | number } | undefined;
    const balance = Number(row?.points_balance ?? 0) + entry.points;
    const spend = amountFromDb(row?.spend_12_m ?? 0) + (entry.baseAmount ?? 0);
    await trx(CUSTOMER_TABLE)
      .where({ id: entry.customerId })
      .update({ points_balance: balance, spend_12_m: spend, updated_at: entry.at });
    await ledger().create({
      data: {
        customerId: entry.customerId,
        kind: entry.kind,
        points: entry.points,
        baseAmount: entry.baseAmount ?? null,
        balanceAfter: balance,
        orderId: entry.orderId ?? null,
        lotId: entry.lotId ?? null,
        actorRef: entry.actorRef ?? null,
        reason: entry.reason ?? null,
        at: entry.at,
      },
    });
    return balance;
  };

  const balanceOf = async (trx: TransactionClient, customerId: number): Promise<number> =>
    Number(
      ((await trx(CUSTOMER_TABLE).where({ id: customerId }).first('points_balance')) as
        | { points_balance: number }
        | undefined)?.points_balance ?? 0,
    );

  /** Open lots of a customer, locked FOR UPDATE in the order they are spent (expiry, then id). */
  const lockLots = async (trx: TransactionClient, customerId: number): Promise<Lot[]> => {
    const rows = (await trx(LOT_TABLE)
      .where({ customer_id: customerId })
      .where('remaining', '>', 0)
      .orderBy([{ column: 'expires_at' }, { column: 'id' }])
      .forUpdate()
      .select('id', 'remaining', 'expires_at')) as LotRow[];
    return rows.map((row) => ({ id: Number(row.id), remaining: Number(row.remaining), expiresAt: new Date(row.expires_at) }));
  };

  const takeLot = async (trx: TransactionClient, lotId: number, points: number, at: Date) => {
    await trx(LOT_TABLE)
      .where({ id: lotId })
      .update({ remaining: trx.raw('remaining - ?', [points]), updated_at: at });
  };

  /**
   * Moves the customer up when the spend cache reaches a higher tier. Down-moves belong to the
   * daily tier job (step 5), which owns the grace period.
   */
  const settleTierUp = async (trx: TransactionClient, customerId: number, at: Date): Promise<void> => {
    const tiers = await tierService().activeTiers();
    if (tiers.length === 0) return;
    const row = (await trx(CUSTOMER_TABLE)
      .where({ id: customerId })
      .first('tier_code', 'tier_below_since', 'spend_12_m')) as
      | { tier_code: string | null; tier_below_since: Date | null; spend_12_m: string | number }
      | undefined;
    if (!row) return;
    const decision = decideTier({
      tiers,
      currentCode: row.tier_code,
      spend12m: amountFromDb(row.spend_12_m),
      belowSince: row.tier_below_since ? new Date(row.tier_below_since) : null,
      now: at,
      graceDays: 0,
    });
    if (decision.action !== 'up') return;
    await trx(CUSTOMER_TABLE)
      .where({ id: customerId })
      .update({ tier_code: decision.to.code, tier_since: at, tier_below_since: null, updated_at: at });
  };

  /**
   * Refund money that counts against earned points: settled refunds on the order except those the
   * earn base already excludes (units canceled before completion, staff order edits).
   */
  const refundedMerchandise = async (trx: TransactionClient, orderId: number): Promise<number> => {
    const row = (await trx('plugins_ordering_refund as r')
      .join('plugins_ordering_refund_order_lnk as l', 'l.refund_id', 'r.id')
      .where('l.order_id', orderId)
      .where('r.status', 'settled')
      .whereRaw(`COALESCE(r.idempotency_key, '') NOT LIKE 'line-cancel:%'`)
      .whereRaw(`COALESCE(r.idempotency_key, '') NOT LIKE 'order-edit:%'`)
      .sum({ value: 'r.amount' })
      .first()) as { value: string | number | null } | undefined;
    return amountFromDb(row?.value ?? 0);
  };

  const service = {
    post,

    /**
     * Earns points for a completed order. Idempotent: under the order mutex it checks for an
     * existing `earn` row (the unique index is the backstop, never the control flow). An order
     * that earns 0 still gets its row — carrying the full base — so it counts toward the tier
     * spend and leaves the sweep. Money refunded before the earn is reversed in the same transaction.
     */
    async earnForOrder(orderId: number, options: { now?: Date } = {}): Promise<EarnOutcome> {
      const config = await settings().get();
      if (!config.enabled) return { status: 'skipped', reason: 'disabled' };
      const now = options.now ?? new Date();
      return strapi.db.transaction(async ({ trx }: { trx: TransactionClient }): Promise<EarnOutcome> => {
        await repo.lockOrder(trx, orderId);
        const head = (await trx('plugins_ordering_order as o')
          .leftJoin('plugins_ordering_order_customer_lnk as l', 'l.order_id', 'o.id')
          .where('o.id', orderId)
          .first('o.id', 'o.status', 'o.completed_at', 'o.receive_method', 'l.customer_id')) as OrderHead | undefined;
        if (!head) return { status: 'skipped', reason: 'order-missing' };
        if (head.status !== 'completed' || !head.completed_at) return { status: 'skipped', reason: 'not-completed' };
        if (config.startsAt && new Date(head.completed_at) < new Date(config.startsAt)) {
          return { status: 'skipped', reason: 'before-start' };
        }
        const kind = parseJson<{ kind?: string }>(head.receive_method, {}).kind ?? '';
        if (!(config.channels as readonly string[]).includes(kind)) return { status: 'skipped', reason: 'channel' };
        if (head.customer_id === null) return { status: 'skipped', reason: 'no-customer' };
        const customerId = Number(head.customer_id);
        const existing = await trx(LEDGER_TABLE).where({ order_id: orderId, kind: 'earn' }).first('id');
        if (existing) return { status: 'skipped', reason: 'already-earned' };

        const customer = await lockCustomerById(trx, customerId);
        if (!customer || customer.status !== 'active') return { status: 'skipped', reason: 'customer-not-active' };

        const lineRows = (await trx('plugins_ordering_order_line as ln')
          .join('plugins_ordering_order_line_order_lnk as l', 'l.order_line_id', 'ln.id')
          .where('l.order_id', orderId)
          .select('ln.quantity', 'ln.priced_quantity', 'ln.canceled_quantity', 'ln.base_amount', 'ln.discount_amount')) as Array<{
          quantity: number;
          priced_quantity: number | null;
          canceled_quantity: number;
          base_amount: string | number;
          discount_amount: string | number;
        }>;
        const cardRow = (await trx('plugins_ordering_payment as p')
          .join('plugins_ordering_payment_order_lnk as l', 'l.payment_id', 'p.id')
          .where('l.order_id', orderId)
          .where('p.provider_code', 'gift-card')
          .select(trx.raw('COALESCE(SUM(p.captured_amount - p.refunded_amount), 0) AS paid'))
          .first()) as { paid: string | number } | undefined;
        const base = earnBase(
          lineRows.map((row) => ({
            quantity: Number(row.quantity),
            pricedQuantity: row.priced_quantity === null ? null : Number(row.priced_quantity),
            canceledQuantity: Number(row.canceled_quantity),
            baseAmount: amountFromDb(row.base_amount),
            discountAmount: amountFromDb(row.discount_amount),
          })),
          amountFromDb(cardRow?.paid ?? 0),
        );

        const tiers = await tierService().activeTiers();
        const spendRow = (await trx(CUSTOMER_TABLE).where({ id: customerId }).first('spend_12_m')) as
          | { spend_12_m: string | number }
          | undefined;
        const held = customer.tierCode ? tiers.find((tier) => tier.code === customer.tierCode) : undefined;
        const tier = held ?? pickTier(tiers, amountFromDb(spendRow?.spend_12_m ?? 0));
        const raw = earnPoints({
          base,
          earnPerAmount: config.earnPerAmount,
          multiplier: tier?.multiplier ?? 100,
        });
        const { start, end } = localDayBounds(now);
        const todayRow = (await trx(LEDGER_TABLE)
          .where({ customer_id: customerId, kind: 'earn' })
          .where('at', '>=', start)
          .where('at', '<', end)
          .sum({ value: 'points' })
          .first()) as { value: string | number | null } | undefined;
        const points = capDailyEarn({
          points: raw,
          earnedToday: Number(todayRow?.value ?? 0),
          dailyCap: config.dailyEarnCap,
        });

        const balanceBefore = await balanceOf(trx, customerId);
        let lotId: number | null = null;
        if (points > 0) {
          const lot = (await lots().create({
            data: {
              customerId,
              orderId,
              source: 'earn',
              points,
              remaining: lotRemainingAfterDebt(balanceBefore, points),
              expiresAt: addMonths(now, config.expiryMonths),
            },
          })) as { id: number };
          lotId = lot.id;
        }
        await post(trx, { customerId, kind: 'earn', points, baseAmount: base, orderId, lotId, at: now });
        await settleTierUp(trx, customerId, now);
        await service.reverseForOrder(trx, orderId, now);
        return { status: 'earned', points, base, capped: points < raw };
      });
    },

    /**
     * Claws back points for money refunded on an earning order. Idempotent and catch-up safe: the
     * target for the total refunded so far, minus what earlier `reverse` rows already took, is the
     * only thing written — so the same refund hooked twice, or refunds that settled before the earn,
     * come out right. Callers hold the order mutex (the refund paths do through the payment lock;
     * it is re-taken here, re-entrant). A negative balance is allowed; redeeming is blocked while it lasts.
     */
    async reverseForOrder(trx: TransactionClient, orderId: number, at: Date = new Date()): Promise<number> {
      const earn = (await trx(LEDGER_TABLE)
        .where({ order_id: orderId, kind: 'earn' })
        .first('customer_id', 'points', 'base_amount', 'lot_id')) as
        | { customer_id: number; points: number; base_amount: string | number | null; lot_id: number | null }
        | undefined;
      if (!earn) return 0;
      await repo.lockOrder(trx, orderId);
      const customerId = Number(earn.customer_id);
      const base = amountFromDb(earn.base_amount ?? 0);
      const refunded = Math.min(await refundedMerchandise(trx, orderId), base);
      if (refunded <= 0) return 0;
      const done = (await trx(LEDGER_TABLE)
        .where({ order_id: orderId, kind: 'reverse' })
        .select(trx.raw('COALESCE(SUM(-points), 0) AS points'), trx.raw('COALESCE(SUM(-base_amount), 0) AS base'))
        .first()) as { points: string | number; base: string | number };
      const pointsDelta =
        reversalTarget({ earnedPoints: Number(earn.points), base, refundedMerchandise: refunded }) - Number(done.points);
      const baseDelta = refunded - amountFromDb(done.base);
      if (pointsDelta <= 0 && baseDelta <= 0) return 0;
      const customer = await lockCustomerById(trx, customerId);
      if (!customer || customer.status === 'erased') return 0;
      const open = await lockLots(trx, customerId);
      const { takes, shortfall } = takeFromLots(open, Math.max(0, pointsDelta), earn.lot_id === null ? [] : [Number(earn.lot_id)]);
      let baseLeft = Math.max(0, baseDelta);
      const rows: Array<{ lotId: number | null; points: number }> = takes.map((take) => ({ lotId: take.lotId, points: take.points }));
      if (shortfall > 0) rows.push({ lotId: null, points: shortfall });
      if (rows.length === 0) rows.push({ lotId: null, points: 0 });
      for (const row of rows) {
        if (row.lotId !== null) await takeLot(trx, row.lotId, row.points, at);
        await post(trx, {
          customerId,
          kind: 'reverse',
          points: -row.points,
          baseAmount: baseLeft > 0 ? -baseLeft : null,
          orderId,
          lotId: row.lotId,
          at,
        });
        baseLeft = 0;
      }
      return Math.max(0, pointsDelta);
    },

    /** Orders that completed, belong to an active customer and have no `earn` row yet — the sweep's worklist. */
    async pendingEarnOrderIds(limit: number, now: Date = new Date()): Promise<number[]> {
      const config = await settings().get();
      if (!config.enabled || config.channels.length === 0) return [];
      const query = strapi.db.connection('plugins_ordering_order as o')
        .join('plugins_ordering_order_customer_lnk as l', 'l.order_id', 'o.id')
        .join('plugins_ordering_customer as c', 'c.id', 'l.customer_id')
        .where('o.status', 'completed')
        .whereNotNull('o.completed_at')
        .where('o.completed_at', '<=', new Date(now.getTime() - 60_000))
        .where('c.status', 'active')
        .whereRaw(`(o.receive_method->>'kind') = ANY(?)`, [config.channels])
        .whereNotExists(
          strapi.db.connection(`${LEDGER_TABLE} as g`).select(strapi.db.connection.raw('1')).whereRaw('g.order_id = o.id').where('g.kind', 'earn'),
        );
      if (config.startsAt) query.where('o.completed_at', '>=', new Date(config.startsAt));
      const rows = (await query.orderBy('o.id').limit(limit).select('o.id')) as Array<{ id: number }>;
      return rows.map((row) => Number(row.id));
    },

    /** Outbox consumer for `order.transitioned`: a completed order earns. */
    async onOrderTransitioned(event: { payload: Record<string, unknown> }): Promise<void> {
      const payload = event.payload as { orderId?: unknown; to?: unknown };
      if (payload.to !== 'completed' || typeof payload.orderId !== 'number') return;
      await service.earnForOrder(payload.orderId);
    },
  };
  return service;
};

export default loyalty;
