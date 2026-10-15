import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { sha256Hex } from '../domain/hashing';
import { addDays } from '../domain/loyalty/lots';
import { decideTier } from '../domain/loyalty/tier';
import { amountFromDb } from '../domain/money';
import { formatLocalDate, type LoyaltyMailData } from '../domain/notifications/templates';
import type { TransactionClient } from '../migrations/runner';
import orderRepository from '../repositories/order';
import type { ServiceContext } from './context';
import type loyaltyFactory from './loyalty';
import type loyaltySettingsFactory from './loyalty-settings';
import type loyaltyTierFactory from './loyalty-tier';
import type notificationTemplateFactory from './notification-template';
import type { OrderingRegistry } from './registry';

const LOT_TABLE = 'plugins_ordering_loyalty_lot';
const LEDGER_TABLE = 'plugins_ordering_loyalty_ledger';
const CUSTOMER_TABLE = 'plugins_ordering_customer';
const TIMEZONE = 'Asia/Ho_Chi_Minh';
const BATCH = 200;

type CustomerMail = {
  id: number;
  status: string;
  email: string | null;
  marketingConsent: { granted?: boolean } | null;
};

/** Twelve calendar months back, in UTC (the program window for spend and history). */
const monthsAgo = (from: Date, months: number): Date => {
  const out = new Date(from.getTime());
  out.setUTCMonth(out.getUTCMonth() - months);
  return out;
};

/**
 * Loyalty lifecycle (O16 step 5): lot expiry and the one-time reminder, the daily tier review,
 * history import for tiers, the Decree 13 forfeit/export, and the customer's own summary. Every
 * point change takes the customer lock first (the lot expiry job never needs an order mutex).
 */
const loyaltyLifecycle = ({ strapi }: { strapi: Core.Strapi }) => {
  const repo = orderRepository({ strapi });
  const plugin = () => strapi.plugin('ordering');
  const loyalty = () => plugin().service('loyalty') as ReturnType<typeof loyaltyFactory>;
  const settings = () => plugin().service('loyalty-settings') as ReturnType<typeof loyaltySettingsFactory>;
  const tierService = () => plugin().service('loyalty-tier') as ReturnType<typeof loyaltyTierFactory>;
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const customers = () => strapi.db.query('plugin::ordering.customer');

  const consentedEmail = async (customerId: number): Promise<CustomerMail | null> => {
    const row = (await customers().findOne({ where: { id: customerId } })) as CustomerMail | null;
    if (!row || row.status !== 'active' || row.marketingConsent?.granted !== true || !row.email) return null;
    return row;
  };

  /**
   * One mail delivery, deduped by the delivery log on a deterministic event id (the same pattern as
   * the cart reminder): a rerun after a crash cannot send twice. `skipped` = email channel off.
   */
  const deliver = async (args: {
    eventId: string;
    template: 'customer.points-expiring' | 'customer.tier-up';
    email: string;
    data: LoyaltyMailData;
    now: Date;
  }): Promise<'sent' | 'skipped' | 'failed' | 'already'> => {
    const deliveries = () => strapi.db.query('plugin::ordering.notification-delivery');
    const key = {
      eventId: args.eventId,
      template: args.template,
      recipientHash: sha256Hex(args.email.trim().toLowerCase()),
    };
    let delivery = (await deliveries().findOne({ where: key })) as { id: number; status: string; attempts: number } | null;
    if (delivery && (delivery.status === 'sent' || delivery.status === 'skipped')) return 'already';
    if (!delivery) {
      delivery = (await deliveries().create({
        data: {
          ...key,
          channel: 'email',
          recipientRole: 'customer',
          orderId: null,
          messageLocale: 'vi',
          status: 'pending',
          attempts: 0,
        },
      })) as { id: number; status: string; attempts: number };
    }
    const rowId = delivery.id;
    const attempt = delivery.attempts + 1;
    const mark = (status: string, extra: Record<string, unknown> = {}) =>
      deliveries().update({ where: { id: rowId }, data: { status, attempts: attempt, ...extra } });
    if (!config().notifications.email.enabled) {
      await mark('skipped');
      return 'skipped';
    }
    try {
      const templates = plugin().service('notification-template') as ReturnType<typeof notificationTemplateFactory>;
      const rendered = await templates.renderFor(args.template, 'vi', args.data);
      await (plugin().service('registry') as OrderingRegistry)
        .notificationProvider('email')
        .send({ recipient: { email: args.email }, template: args.template, data: rendered });
      await mark('sent', { sentAt: args.now });
      return 'sent';
    } catch (error) {
      await mark('failed', { lastError: String((error as Error)?.message ?? error).slice(0, 500) });
      return 'failed';
    }
  };

  const service = {
    /**
     * Writes off lots past their date, one customer-locked transaction per lot. Idempotent: a lot
     * that is empty or already handled leaves the worklist. Not run while the program is off ("không hết
     * hạn mới"), so switching it off pauses the clock for nobody — expiry resumes on re-enable.
     */
    async expireDue(now: Date, limit = BATCH): Promise<{ expired: number; points: number }> {
      if (!(await settings().get()).enabled) return { expired: 0, points: 0 };
      const due = (await strapi.db
        .connection(LOT_TABLE)
        .where('remaining', '>', 0)
        .where('expires_at', '<=', now)
        .orderBy('id')
        .limit(limit)
        .select('id', 'customer_id')) as Array<{ id: number; customer_id: number }>;
      let expired = 0;
      let points = 0;
      for (const row of due) {
        const taken = await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
          const customer = await loyalty().lockCustomerById(trx, Number(row.customer_id));
          if (!customer) return 0;
          const lot = (await trx(LOT_TABLE).where({ id: row.id }).forUpdate().first('id', 'remaining', 'expires_at')) as
            | { id: number; remaining: number; expires_at: Date }
            | undefined;
          if (!lot || lot.remaining <= 0 || new Date(lot.expires_at) > now) return 0;
          await loyalty().takeLot(trx, lot.id, lot.remaining, now);
          await loyalty().post(trx, {
            customerId: Number(row.customer_id),
            kind: 'expire',
            points: -lot.remaining,
            lotId: lot.id,
            actorRef: 'system',
            at: now,
          });
          return lot.remaining;
        });
        if (taken > 0) {
          expired += 1;
          points += taken;
        }
      }
      return { expired, points };
    },

    /**
     * One mail per customer, once per lot: lots expiring within `expiryReminderDays` that were never
     * reminded. Only active customers with marketing consent and an email; the others stay unmarked and
     * are re-evaluated (and may consent later). `reminderSentAt` is stamped on sent/skipped/already.
     */
    async remindDue(now: Date): Promise<{ sent: number; failed: number; skipped: number }> {
      const config$ = await settings().get();
      if (!config$.enabled || config$.expiryReminderDays <= 0) return { sent: 0, failed: 0, skipped: 0 };
      const horizon = addDays(now, config$.expiryReminderDays);
      const due = (await strapi.db
        .connection(LOT_TABLE)
        .where('remaining', '>', 0)
        .whereNull('reminder_sent_at')
        .where('expires_at', '>', now)
        .where('expires_at', '<=', horizon)
        .orderBy('id')
        .limit(BATCH * 5)
        .select('id', 'customer_id', 'remaining', 'expires_at')) as Array<{
        id: number;
        customer_id: number;
        remaining: number;
        expires_at: Date;
      }>;
      const byCustomer = new Map<number, typeof due>();
      for (const lot of due) byCustomer.set(Number(lot.customer_id), [...(byCustomer.get(Number(lot.customer_id)) ?? []), lot]);
      let sent = 0;
      let failed = 0;
      let skipped = 0;
      for (const [customerId, lots] of byCustomer) {
        const customer = await consentedEmail(customerId);
        if (!customer?.email) continue;
        const soonest = lots.reduce((min, lot) => (new Date(lot.expires_at) < new Date(min.expires_at) ? lot : min));
        const balance = Number(
          ((await strapi.db.connection(CUSTOMER_TABLE).where({ id: customerId }).first('points_balance')) as { points_balance: number })
            .points_balance,
        );
        const outcome = await deliver({
          eventId: `points-expiring:${customerId}:${lots.map((lot) => lot.id).join('-')}`,
          template: 'customer.points-expiring',
          email: customer.email,
          data: {
            points: lots.reduce((sum, lot) => sum + Number(lot.remaining), 0),
            expiresAt: formatLocalDate(new Date(soonest.expires_at).toISOString(), TIMEZONE),
            balance,
          },
          now,
        });
        if (outcome === 'failed') {
          failed += 1;
          continue;
        }
        if (outcome === 'sent') sent += 1;
        else skipped += 1;
        await strapi.db
          .connection(LOT_TABLE)
          .whereIn(
            'id',
            lots.map((lot) => lot.id),
          )
          .update({ reminder_sent_at: now });
      }
      return { sent, failed, skipped };
    },

    /** Spend over the last 12 months from the ledger (refunds count only against earns in the window). */
    async spendSince(connection: TransactionClient, customerId: number, since: Date): Promise<number> {
      const row = (await connection.raw(
        `SELECT COALESCE(SUM(g.base_amount), 0)::bigint AS spend
         FROM ${LEDGER_TABLE} g
         WHERE g.customer_id = ? AND g.at >= ?
           AND (g.kind IN ('earn', 'history')
                OR (g.kind = 'reverse' AND EXISTS (
                      SELECT 1 FROM ${LEDGER_TABLE} e
                      WHERE e.order_id = g.order_id AND e.kind IN ('earn', 'history') AND e.at >= ?)))`,
        [customerId, since, since],
      )) as { rows: Array<{ spend: string | number }> };
      return amountFromDb(row.rows[0]?.spend ?? 0);
    },

    /**
     * Daily tier review: recompute each customer's 12-month spend from the ledger, then move the tier —
     * up at once, down only after `downgradeGraceDays` below the threshold. Customers without any loyalty
     * ledger row are skipped. Idempotent; one customer-locked transaction each.
     */
    async refreshTiers(now: Date): Promise<{ checked: number; up: number; down: number }> {
      const config$ = await settings().get();
      if (!config$.enabled) return { checked: 0, up: 0, down: 0 };
      const tiers = await tierService().activeTiers();
      if (tiers.length === 0) return { checked: 0, up: 0, down: 0 };
      const since = monthsAgo(now, 12);
      let checked = 0;
      let up = 0;
      let down = 0;
      let afterId = 0;
      for (;;) {
        const batch = (await strapi.db
          .connection(CUSTOMER_TABLE)
          .where('id', '>', afterId)
          .where('status', 'active')
          .whereExists(
            strapi.db.connection(`${LEDGER_TABLE} as g`).select(strapi.db.connection.raw('1')).whereRaw('g.customer_id = plugins_ordering_customer.id'),
          )
          .orderBy('id')
          .limit(BATCH)
          .select('id')) as Array<{ id: number }>;
        if (batch.length === 0) break;
        afterId = Number(batch[batch.length - 1].id);
        for (const { id } of batch) {
          await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
            const customer = await loyalty().lockCustomerById(trx, id);
            if (!customer || customer.status !== 'active') return;
            const spend = await service.spendSince(trx, id, since);
            await trx(CUSTOMER_TABLE).where({ id }).update({ spend_12_m: spend, updated_at: now });
            const decision = decideTier({
              tiers,
              currentCode: customer.tierCode,
              spend12m: spend,
              belowSince: customer.belowSince,
              now,
              graceDays: config$.downgradeGraceDays,
            });
            checked += 1;
            if (decision.action === 'up') {
              await loyalty().applyTier(trx, id, decision.to, customer.tierCode, now);
              up += 1;
            } else if (decision.action === 'down') {
              await loyalty().applyTier(trx, id, decision.to, customer.tierCode, now);
              down += 1;
            } else if (decision.action === 'start-grace') {
              await trx(CUSTOMER_TABLE).where({ id }).update({ tier_below_since: decision.belowSince, updated_at: now });
            } else if (decision.action === 'keep' && customer.belowSince) {
              await trx(CUSTOMER_TABLE).where({ id }).update({ tier_below_since: null, updated_at: now });
            }
          });
        }
      }
      return { checked, up, down };
    },

    /**
     * "Tính hạng theo lịch sử": completed orders of the last 12 months that earned nothing (they finished
     * before the program) get a 0-point `history` row carrying their earn base, so tiers can start from
     * real spend. Only when `countHistoryForTiers`. Idempotent per order; then the tiers are reviewed.
     */
    async recalculateHistory(now: Date): Promise<{ orders: number; customers: number }> {
      const config$ = await settings().get();
      if (!config$.enabled || !config$.countHistoryForTiers) return { orders: 0, customers: 0 };
      const since = monthsAgo(now, 12);
      const candidates = (await strapi.db
        .connection('plugins_ordering_order as o')
        .join('plugins_ordering_order_customer_lnk as l', 'l.order_id', 'o.id')
        .join(`${CUSTOMER_TABLE} as c`, 'c.id', 'l.customer_id')
        .where('o.status', 'completed')
        .where('o.completed_at', '>=', since)
        .where('o.completed_at', '<=', now)
        .where('c.status', 'active')
        .whereNotExists(
          strapi.db
            .connection(`${LEDGER_TABLE} as g`)
            .select(strapi.db.connection.raw('1'))
            .whereRaw('g.order_id = o.id')
            .whereIn('g.kind', ['earn', 'history']),
        )
        .orderBy('o.id')
        .select('o.id as order_id', 'o.completed_at', 'l.customer_id')) as Array<{
        order_id: number;
        completed_at: Date;
        customer_id: number;
      }>;
      let orders = 0;
      const touched = new Set<number>();
      for (const row of candidates) {
        const written = await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
          await repo.lockOrder(trx, Number(row.order_id));
          const customer = await loyalty().lockCustomerById(trx, Number(row.customer_id));
          if (!customer || customer.status !== 'active') return false;
          const exists = await trx(LEDGER_TABLE)
            .where({ order_id: row.order_id })
            .whereIn('kind', ['earn', 'history'])
            .first('id');
          if (exists) return false;
          const base = await loyalty().orderEarnBase(trx, Number(row.order_id));
          if (base <= 0) return false;
          await loyalty().post(trx, {
            customerId: Number(row.customer_id),
            kind: 'history',
            points: 0,
            baseAmount: base,
            orderId: Number(row.order_id),
            actorRef: 'system',
            reason: 'tier-history',
            at: new Date(row.completed_at),
          });
          return true;
        });
        if (written) {
          orders += 1;
          touched.add(Number(row.customer_id));
        }
      }
      await service.refreshTiers(now);
      return { orders, customers: touched.size };
    },

    /**
     * Decree 13 erase: the remaining points are written off (`forfeit`), every lot emptied, tier and spend
     * cleared. The ledger keeps its rows (ids and numbers only). Runs inside the erase transaction, which
     * already holds the customer lock.
     */
    async forfeitInTransaction(trx: TransactionClient, customerId: number, now: Date): Promise<void> {
      const open = (await trx(LOT_TABLE)
        .where({ customer_id: customerId })
        .where('remaining', '>', 0)
        .orderBy('id')
        .forUpdate()
        .select('id', 'remaining')) as Array<{ id: number; remaining: number }>;
      for (const lot of open) {
        await loyalty().takeLot(trx, lot.id, lot.remaining, now);
        await loyalty().post(trx, {
          customerId,
          kind: 'forfeit',
          points: -lot.remaining,
          lotId: lot.id,
          actorRef: 'system',
          reason: 'erasure',
          at: now,
        });
      }
      const balance = await loyalty().balanceOf(trx, customerId);
      if (balance < 0) {
        await loyalty().post(trx, { customerId, kind: 'forfeit', points: -balance, actorRef: 'system', reason: 'erasure', at: now });
      }
      await trx(CUSTOMER_TABLE).where({ id: customerId }).update({
        tier_code: null,
        tier_since: null,
        tier_below_since: null,
        spend_12_m: 0,
        updated_at: now,
      });
    },

    /** Points section of `/me/data-export` (access right): balance, tier, lots and the ledger, ids only. */
    async exportForCustomer(customerId: number) {
      const knex = strapi.db.connection;
      const profile = (await knex(CUSTOMER_TABLE).where({ id: customerId }).first('points_balance', 'tier_code', 'tier_since', 'spend_12_m')) as
        | { points_balance: number; tier_code: string | null; tier_since: Date | null; spend_12_m: string | number }
        | undefined;
      const lotRows = (await knex(LOT_TABLE).where({ customer_id: customerId }).orderBy('id').select('source', 'points', 'remaining', 'expires_at', 'created_at')) as Array<
        Record<string, unknown>
      >;
      const ledgerRows = (await knex(`${LEDGER_TABLE} as g`)
        .leftJoin('plugins_ordering_order as o', 'o.id', 'g.order_id')
        .where('g.customer_id', customerId)
        .orderBy('g.id')
        .select('g.at', 'g.kind', 'g.points', 'g.balance_after', 'g.base_amount', 'o.code as order_code')) as Array<Record<string, unknown>>;
      return {
        balance: Number(profile?.points_balance ?? 0),
        tier: profile?.tier_code ?? null,
        tierSince: profile?.tier_since ?? null,
        spend12m: amountFromDb(profile?.spend_12_m ?? 0),
        lots: lotRows.map((row) => ({
          source: row.source,
          points: row.points,
          remaining: row.remaining,
          expiresAt: row.expires_at,
          createdAt: row.created_at,
        })),
        ledger: ledgerRows.map((row) => ({
          at: row.at,
          kind: row.kind,
          points: row.points,
          balanceAfter: row.balance_after,
          baseAmount: row.base_amount === null ? null : amountFromDb(row.base_amount as string | number),
          orderCode: row.order_code ?? null,
        })),
      };
    },

    /** GET /me/loyalty. Staff-only notes never appear (the ledger carries none to the customer). */
    async summaryFor(customerId: number, now: Date = new Date()) {
      const config$ = await settings().get();
      const knex = strapi.db.connection;
      const customer = (await knex(CUSTOMER_TABLE).where({ id: customerId }).first('points_balance', 'tier_code', 'spend_12_m')) as
        | { points_balance: number; tier_code: string | null; spend_12_m: string | number }
        | undefined;
      const tiers = await tierService().allTiers();
      const active = tiers.filter((tier) => tier.active).map((tier) => ({ ...tier, minSpend12m: tier.minSpend12m }));
      const current = tiers.find((tier) => tier.code === customer?.tier_code) ?? null;
      const spend = amountFromDb(customer?.spend_12_m ?? 0);
      const next = active.sort((a, b) => a.minSpend12m - b.minSpend12m).find((tier) => tier.minSpend12m > spend) ?? null;
      const expiring = (await knex(LOT_TABLE)
        .where({ customer_id: customerId })
        .where('remaining', '>', 0)
        .where('expires_at', '>', now)
        .where('expires_at', '<=', addDays(now, 30))
        .orderBy('expires_at')
        .limit(5)
        .select('remaining', 'expires_at')) as Array<{ remaining: number; expires_at: Date }>;
      return {
        enabled: config$.enabled,
        balance: Number(customer?.points_balance ?? 0),
        value: config$.pointValue,
        tier: current
          ? { code: current.code, name: current.name, multiplier: current.multiplier }
          : null,
        nextTier: next ? { name: next.name, missing: next.minSpend12m - spend } : null,
        expiringSoon: expiring.map((row) => ({ points: Number(row.remaining), expiresAt: new Date(row.expires_at).toISOString() })),
      };
    },

    /** GET /me/loyalty/history — the ledger without staff references or free-text reasons. */
    async historyFor(customerId: number, page = 1) {
      const pageSize = 20;
      const knex = strapi.db.connection;
      const total = Number(
        ((await knex(LEDGER_TABLE).where({ customer_id: customerId }).count({ n: '*' }).first()) as { n: string | number }).n,
      );
      const rows = (await knex(`${LEDGER_TABLE} as g`)
        .leftJoin('plugins_ordering_order as o', 'o.id', 'g.order_id')
        .where('g.customer_id', customerId)
        .whereNot('g.kind', 'history')
        .orderBy('g.id', 'desc')
        .limit(pageSize)
        .offset((Math.max(1, page) - 1) * pageSize)
        .select('g.at', 'g.kind', 'g.points', 'g.balance_after', 'o.code as order_code')) as Array<Record<string, unknown>>;
      return {
        items: rows.map((row) => ({
          at: row.at,
          kind: row.kind,
          points: row.points,
          balanceAfter: row.balance_after,
          orderCode: row.order_code ?? null,
        })),
        total,
        page: Math.max(1, page),
        pageSize,
      };
    },

    /** Outbox consumer for `loyalty.tier.changed`: a move up mails the congratulation (consented customers only). */
    async onTierChanged(event: { payload: Record<string, unknown> }, ctx?: ServiceContext): Promise<void> {
      void ctx;
      const payload = event.payload as { customerId?: number; tierCode?: string; previousTierCode?: string | null };
      if (typeof payload.customerId !== 'number' || !payload.tierCode) return;
      const tiers = await tierService().allTiers();
      const next = tiers.find((tier) => tier.code === payload.tierCode);
      const previous = tiers.find((tier) => tier.code === payload.previousTierCode);
      // First placement and moves down send nothing.
      if (!next || !previous || next.minSpend12m <= previous.minSpend12m) return;
      const customer = await consentedEmail(payload.customerId);
      if (!customer?.email) return;
      const balance = Number(
        ((await strapi.db.connection(CUSTOMER_TABLE).where({ id: payload.customerId }).first('points_balance')) as { points_balance: number }).points_balance,
      );
      await deliver({
        eventId: `tier-up:${payload.customerId}:${payload.tierCode}:${(event as { id?: number }).id ?? 0}`,
        template: 'customer.tier-up',
        email: customer.email,
        data: {
          balance,
          tierName: next.name.vi ?? next.code,
          multiplier: (next.multiplier / 100).toLocaleString('vi-VN'),
        },
        now: new Date(),
      });
    },
  };
  return service;
};

export default loyaltyLifecycle;
