import { createHmac } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import {
  evaluate,
  rejectionReason,
  type AppliedPromotion,
  type EvaluateInput,
  type PromotionLine,
  type PromotionSnapshot,
  type RejectedPromotion,
} from '../domain/promotions/evaluate';
import type { PricingAdjustmentInput } from '../domain/pricing/pipeline';
import { parseEncryptionKey } from '../domain/token-cipher';
import type { TransactionClient } from '../migrations/runner';

type PromotionRow = {
  id: number;
  name: { vi?: string; en?: string } | string;
  kind: 'code' | 'auto';
  discountType: PromotionSnapshot['discountType'];
  value: number | null;
  maxDiscount: number | null;
  target: PromotionSnapshot['target'] | string;
  minSubtotal: number | null;
  locationRefs: string[] | null | string;
  receiveKinds: Array<'pickup' | 'delivery' | 'digital' | 'dine-in'> | string;
  startsAt: string;
  endsAt: string | null;
  weekdays: string[] | string;
  timeRanges: PromotionSnapshot['timeRanges'] | string;
  firstOrderOnly: boolean;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  stackable: boolean;
  priority: number | null;
  active: boolean;
  usedCount: number | null;
};

type CodeRow = {
  id: number;
  promotionId: number;
  code: string;
  usageLimit: number | null;
  usedCount: number | null;
  active: boolean;
};

/** A promotion whose outcome depends on the phone's history (first order, per-customer limit). */
export type PendingPromotion = { code: string; label: string; condition: 'first-order' | 'per-customer' };

export type ResolvedPromotions = {
  /** Decision with the phone's real history — what create applies. */
  adjustments: PricingAdjustmentInput[];
  applied: AppliedPromotion[];
  rejected: RejectedPromotion[];
  customerKey: string | null;
  entered?: PromotionSnapshot | null;
  /**
   * Decision without any phone history — what the public quote shows. Phone-dependent promotions
   * are left out and listed in `pending`, so a quote never tells a stranger whether a number has
   * ordered before; create checks them for real and can only lower the quoted total.
   */
  quote: {
    adjustments: PricingAdjustmentInput[];
    applied: AppliedPromotion[];
    rejected: RejectedPromotion[];
    pending: PendingPromotion[];
  };
};

const phoneDependent = (promo: PromotionSnapshot): boolean =>
  promo.firstOrderOnly || promo.perCustomerLimit !== null;

const asObject = <T>(value: T | string | null | undefined, fallback: T): T => {
  if (value == null) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
  return value;
};

const labelOf = (name: PromotionRow['name'], locale: string): string => {
  const parsed = asObject(name, {} as { vi?: string; en?: string });
  if (locale === 'en' && parsed.en) return parsed.en;
  return parsed.vi || parsed.en || 'Khuyến mãi';
};

const snapshotOf = (row: PromotionRow, code: string, locale: string): PromotionSnapshot => ({
  id: row.id,
  code,
  label: labelOf(row.name, locale),
  kind: row.kind,
  discountType: row.discountType,
  value: row.value,
  maxDiscount: row.maxDiscount,
  target: asObject(row.target, { kind: 'order', refs: [] }),
  minSubtotal: row.minSubtotal ?? 0,
  locationRefs: asObject<string[] | null>(row.locationRefs, null),
  receiveKinds: asObject(row.receiveKinds, ['pickup', 'delivery']),
  startsAt: new Date(row.startsAt).toISOString(),
  endsAt: row.endsAt ? new Date(row.endsAt).toISOString() : null,
  weekdays: asObject(row.weekdays, []),
  timeRanges: asObject(row.timeRanges, []),
  firstOrderOnly: row.firstOrderOnly,
  perCustomerLimit: row.perCustomerLimit,
  stackable: row.stackable,
  priority: row.priority ?? 0,
});

const adjustmentOf = (promo: AppliedPromotion): PricingAdjustmentInput => ({
  kind: 'discount',
  code: promo.code,
  label: promo.label,
  amount: promo.amount,
  taxable: true,
  priority: promo.priority,
  sourceRef: `promotion:${promo.promotionId}`,
  ruleSnapshot: promo.ruleSnapshot,
  target: promo.target,
});

/** HMAC of the E.164 phone. The raw number is never stored on a redemption. */
export const customerKeyFor = (key: Buffer, phoneE164: string): string =>
  createHmac('sha256', key).update(phoneE164).digest('hex');

const CODE_PATTERN = /^[A-Z0-9-]{4,32}$/;

export const normalizePromotionCode = (code: string): string | null => {
  const normalized = code.trim().toUpperCase();
  return CODE_PATTERN.test(normalized) ? normalized : null;
};

const promotionError = (
  rejected: RejectedPromotion,
  promo: PromotionSnapshot | undefined,
  subtotal: number,
): OrderingError => {
  if (rejected.reason === 'invalid') {
    return new OrderingError('PROMOTION_INVALID', 'promotion code is not valid');
  }
  if (rejected.reason === 'not-started' || rejected.reason === 'ended') {
    return new OrderingError('PROMOTION_EXPIRED', 'promotion code is not valid right now', {
      details: { reason: rejected.reason },
    });
  }
  if (rejected.reason === 'usage-limit' || rejected.reason === 'code-used') {
    return new OrderingError('PROMOTION_EXHAUSTED', 'promotion code has no uses left', {
      details: { reason: rejected.reason },
    });
  }
  const details: Record<string, unknown> = { reason: rejected.reason };
  if (rejected.reason === 'min-subtotal' && promo) {
    details.minSubtotal = promo.minSubtotal;
    details.missing = Math.max(0, promo.minSubtotal - subtotal);
  }
  return new OrderingError('PROMOTION_NOT_ELIGIBLE', 'promotion code does not apply to this order', {
    details,
  });
};

const promotionService = ({ strapi }: { strapi: Core.Strapi }) => {
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const promotions = () => strapi.db.query('plugin::ordering.promotion');
  const codes = () => strapi.db.query('plugin::ordering.promotion-code');

  const hmacKey = (): Buffer => {
    const parsed = parseEncryptionKey(config().encryptionKey);
    if (!parsed.valid) {
      throw new OrderingError('CONFIG_INVALID', 'ordering encryptionKey is not configured');
    }
    return parsed.key;
  };

  return {
    customerKey(phoneE164: string): string {
      return customerKeyFor(hmacKey(), phoneE164);
    },

    /**
     * Quote and create share this. A bad entered code is returned in `rejected` and is not
     * applied; the caller throws on create and shows it on the quote. Automatic misses stay quiet.
     */
    async resolve(input: {
      now: Date;
      timezone: string;
      locationRef: string;
      receiveKind: 'pickup' | 'delivery' | 'digital' | 'dine-in';
      lines: PromotionLine[];
      fulfillmentAmount: number;
      subtotal: number;
      locale: string;
      phoneE164?: string;
      code?: string;
    }): Promise<ResolvedPromotions> {
      const normalized = input.code ? normalizePromotionCode(input.code) : null;
      if (input.code && !normalized) {
        const rejected = [{ code: input.code.trim().slice(0, 4), reason: 'invalid' }];
        return {
          adjustments: [],
          applied: [],
          rejected,
          customerKey: null,
          quote: { adjustments: [], applied: [], rejected, pending: [] },
        };
      }

      const rows = (await promotions().findMany({ where: { active: true } })) as PromotionRow[];
      let codeRow: CodeRow | null = null;
      if (normalized) {
        codeRow = (await codes().findOne({ where: { code: normalized } })) as CodeRow | null;
      }
      const byId = new Map(rows.map((row) => [row.id, row]));
      const candidates: PromotionSnapshot[] = [];
      const rejected: RejectedPromotion[] = [];

      for (const row of rows) {
        if (row.kind !== 'auto') continue;
        if (row.usageLimit != null && (row.usedCount ?? 0) >= row.usageLimit) continue;
        candidates.push(snapshotOf(row, `P${row.id}`, input.locale));
      }

      let entered: PromotionSnapshot | undefined;
      if (normalized) {
        const promo = codeRow && codeRow.active ? byId.get(codeRow.promotionId) : undefined;
        if (!codeRow || !codeRow.active || !promo || promo.kind !== 'code') {
          rejected.push({ code: normalized, reason: 'invalid' });
        } else if (codeRow.usageLimit != null && (codeRow.usedCount ?? 0) >= codeRow.usageLimit) {
          rejected.push({ code: normalized, reason: 'code-used' });
        } else if (promo.usageLimit != null && (promo.usedCount ?? 0) >= promo.usageLimit) {
          rejected.push({ code: normalized, reason: 'usage-limit' });
        } else {
          entered = snapshotOf(promo, normalized, input.locale);
          candidates.push(entered);
        }
      }

      const phone = input.phoneE164 && input.phoneE164.startsWith('+') ? input.phoneE164 : '';
      const customerKey = phone ? customerKeyFor(hmacKey(), phone) : null;
      const customer = { isFirstOrder: true, usedByPromotion: {} as Record<number, number> };
      if (phone) {
        await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
          const prior = await trx.raw(
            `SELECT 1 FROM plugins_ordering_order
             WHERE contact_snapshot->>'phone' = ?
               AND status NOT IN ('draft', 'canceled')
             LIMIT 1`,
            [phone],
          );
          const priorRows = (prior.rows ?? prior) as unknown[];
          customer.isFirstOrder = priorRows.length === 0;
          if (customerKey && candidates.length > 0) {
            const counts = await trx.raw(
              `SELECT promotion_id, count(*)::int AS used
               FROM plugins_ordering_promotion_redemption
               WHERE customer_key = ? AND status IN ('reserved', 'applied')
               GROUP BY promotion_id`,
              [customerKey],
            );
            for (const row of (counts.rows ?? []) as Array<{ promotion_id: number; used: number }>) {
              customer.usedByPromotion[row.promotion_id] = Number(row.used);
            }
          }
        });
      }

      const base = {
        now: input.now,
        timezone: input.timezone,
        locationRef: input.locationRef,
        receiveKind: input.receiveKind,
        lines: input.lines,
        fulfillmentAmount: input.fulfillmentAmount,
        subtotal: input.subtotal,
      };
      const decision = evaluate({
        ...base,
        candidates,
        ...(normalized ? { code: normalized } : {}),
        customer,
      } satisfies EvaluateInput);

      // Quote view: no phone history at all. Phone-dependent promotions are listed as pending
      // when everything else about them holds; create decides them with the real history.
      const guest = { isFirstOrder: true, usedByPromotion: {} as Record<number, number> };
      const enteredPending = entered !== undefined && phoneDependent(entered);
      const quoteDecision = evaluate({
        ...base,
        candidates: candidates.filter((promo) => !phoneDependent(promo)),
        ...(normalized && !enteredPending ? { code: normalized } : {}),
        customer: guest,
      } satisfies EvaluateInput);
      const pending: PendingPromotion[] = [];
      const quoteRejected: RejectedPromotion[] = [...rejected, ...quoteDecision.rejected];
      for (const promo of candidates.filter(phoneDependent)) {
        const reason = rejectionReason(promo, { ...base, candidates, customer: guest });
        const isEntered = promo === entered;
        if (reason === null) {
          pending.push({
            code: promo.code,
            label: promo.label,
            condition: promo.firstOrderOnly ? 'first-order' : 'per-customer',
          });
        } else if (isEntered) {
          quoteRejected.push({ code: promo.code, reason });
        }
      }

      return {
        adjustments: decision.applied.map(adjustmentOf),
        applied: decision.applied,
        rejected: [...rejected, ...decision.rejected],
        customerKey,
        entered: entered ?? null,
        quote: {
          adjustments: quoteDecision.applied.map(adjustmentOf),
          applied: quoteDecision.applied,
          rejected: quoteRejected,
          pending,
        },
      };
    },

    throwIfCodeRejected(resolved: ResolvedPromotions, subtotal: number): void {
      const failure = resolved.rejected.find((row) => row.reason !== 'not-best');
      if (!failure) return;
      throw promotionError(failure, resolved.entered ?? undefined, subtotal);
    },

    /**
     * Locks promotions then codes in id order and records a `reserved` redemption.
     * An entered code that lost the race throws. An automatic promotion that lost is dropped
     * so the caller can price again without it.
     */
    async reserveInTransaction(
      trx: TransactionClient,
      orderId: number,
      applied: AppliedPromotion[],
      customerKey: string,
      now: Date,
    ): Promise<{
      dropped: number[];
      /** What was actually reserved (dropped ones excluded); `code` is null for an automatic promotion. */
      reserved: Array<{ promotionId: number; code: string | null; discountAmount: number }>;
    }> {
      const dropped: number[] = [];
      const reserved: Array<{ promotionId: number; code: string | null; discountAmount: number }> = [];
      const ordered = [...applied].sort((a, b) => a.promotionId - b.promotionId);
      const lockedPromos = new Map<
        number,
        { kind: string; used_count: number; usage_limit: number | null; per_customer_limit: number | null }
      >();
      for (const promo of ordered) {
        const row = await trx('plugins_ordering_promotion').where({ id: promo.promotionId }).forUpdate().first();
        if (!row || row.active === false) {
          // An entered code switched off since pricing must not turn into a silent full-price order.
          if (row?.kind === 'code') {
            throw new OrderingError('PROMOTION_INVALID', 'promotion code is not valid');
          }
          dropped.push(promo.promotionId);
          continue;
        }
        lockedPromos.set(promo.promotionId, {
          kind: String(row.kind),
          used_count: Number(row.used_count ?? 0),
          usage_limit: row.usage_limit == null ? null : Number(row.usage_limit),
          // First-order-only means one use per phone; under this lock that also stops two
          // simultaneous "first" orders from the same number both getting it.
          per_customer_limit:
            row.first_order_only === true
              ? Math.min(1, row.per_customer_limit == null ? 1 : Number(row.per_customer_limit))
              : row.per_customer_limit == null
                ? null
                : Number(row.per_customer_limit),
        });
      }
      const codeIds = new Map<number, number>();
      for (const promo of ordered) {
        if (dropped.includes(promo.promotionId)) continue;
        // The locked row's kind decides; an auto promotion's synthetic `P<id>` can equal a real code.
        if (lockedPromos.get(promo.promotionId)?.kind !== 'code') continue;
        const codeRow = await trx('plugins_ordering_promotion_code')
          .where({ promotion_id: promo.promotionId, code: promo.code })
          .forUpdate()
          .first();
        if (!codeRow || codeRow.active === false) {
          throw new OrderingError('PROMOTION_EXHAUSTED', 'promotion code has no uses left', {
            details: { reason: 'code-used' },
          });
        }
        if (codeRow.usage_limit != null && Number(codeRow.used_count ?? 0) >= Number(codeRow.usage_limit)) {
          throw new OrderingError('PROMOTION_EXHAUSTED', 'promotion code has no uses left', {
            details: { reason: 'code-used' },
          });
        }
        codeIds.set(promo.promotionId, Number(codeRow.id));
      }

      for (const promo of ordered) {
        if (dropped.includes(promo.promotionId)) continue;
        const locked = lockedPromos.get(promo.promotionId);
        const isCode = locked?.kind === 'code';
        if (!locked || (locked.usage_limit != null && locked.used_count >= locked.usage_limit)) {
          if (isCode) {
            throw new OrderingError('PROMOTION_EXHAUSTED', 'promotion code has no uses left', {
              details: { reason: 'usage-limit' },
            });
          }
          dropped.push(promo.promotionId);
          continue;
        }
        if (locked.per_customer_limit != null) {
          const countResult = await trx.raw(
            `SELECT count(*)::int AS used
             FROM plugins_ordering_promotion_redemption
             WHERE promotion_id = ? AND customer_key = ? AND status IN ('reserved', 'applied')`,
            [promo.promotionId, customerKey],
          );
          const used = Number((countResult.rows?.[0] as { used?: number } | undefined)?.used ?? 0);
          if (used >= locked.per_customer_limit) {
            if (isCode) {
              throw new OrderingError('PROMOTION_NOT_ELIGIBLE', 'promotion code does not apply to this order', {
                details: { reason: 'per-customer' },
              });
            }
            dropped.push(promo.promotionId);
            continue;
          }
        }
        await trx('plugins_ordering_promotion_redemption').insert({
          promotion_id: promo.promotionId,
          promotion_code_id: codeIds.get(promo.promotionId) ?? null,
          order_id: orderId,
          customer_key: customerKey,
          discount_amount: Math.abs(promo.amount),
          status: 'reserved',
          reserved_at: now,
          created_at: now,
          updated_at: now,
        });
        await trx('plugins_ordering_promotion')
          .where({ id: promo.promotionId })
          .update({ used_count: locked.used_count + 1 });
        locked.used_count += 1;
        reserved.push({
          promotionId: promo.promotionId,
          code: isCode ? promo.code : null,
          discountAmount: Math.abs(promo.amount),
        });
        const codeId = codeIds.get(promo.promotionId);
        if (codeId) {
          await trx('plugins_ordering_promotion_code').where({ id: codeId }).increment('used_count', 1);
        }
      }
      return { dropped, reserved };
    },

    async releaseForOrder(trx: TransactionClient, orderId: number, reason: string, now: Date): Promise<void> {
      const rows = (await trx('plugins_ordering_promotion_redemption')
        .where({ order_id: orderId, status: 'reserved' })
        .forUpdate()) as Array<{ id: number; promotion_id: number; promotion_code_id: number | null }>;
      for (const row of rows) {
        await trx('plugins_ordering_promotion')
          .where({ id: row.promotion_id })
          .where('used_count', '>', 0)
          .decrement('used_count', 1);
        if (row.promotion_code_id) {
          await trx('plugins_ordering_promotion_code')
            .where({ id: row.promotion_code_id })
            .where('used_count', '>', 0)
            .decrement('used_count', 1);
        }
        await trx('plugins_ordering_promotion_redemption').where({ id: row.id }).update({
          status: 'released',
          released_at: now,
          release_reason: reason,
        });
      }
    },

    async markApplied(trx: TransactionClient, orderId: number, now: Date): Promise<void> {
      await trx('plugins_ordering_promotion_redemption')
        .where({ order_id: orderId, status: 'reserved' })
        .update({ status: 'applied', applied_at: now });
    },

  };
};

export default promotionService;
