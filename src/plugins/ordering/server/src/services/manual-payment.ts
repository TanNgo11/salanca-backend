import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { assertSafeAmount } from '../domain/money';
import type { ServiceContext } from './context';
import { nowOf } from './context';
import type changeLogFactory from './change-log';
import type orderServiceFactory from './order';
import type paymentMatchingFactory from './payment-matching';

const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9-]{3,40}$/;
const MAX_NOTE = 500;

const isUniqueViolation = (error: unknown): boolean =>
  (error as { code?: string }).code === '23505' ||
  (error as { cause?: { code?: string } }).cause?.code === '23505';

const invalid = (field: string, message: string): OrderingError =>
  new OrderingError('VALIDATION_ERROR', message, { details: { field } });

/**
 * Staff record a transfer they saw in the banking app (contracts §19.1). The bank reference
 * is the event id. A later webhook with the same reference and the same amount attaches to
 * this row inside `payment-matching` and does not capture again. The staff note is only the
 * change-log `reason` — `note` would be redacted, and the raw transfer text is not stored.
 */
const manualPayment = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const order = () => plugin().service('order') as ReturnType<typeof orderServiceFactory>;
  const matching = () => plugin().service('payment-matching') as ReturnType<typeof paymentMatchingFactory>;
  const changeLog = () => plugin().service('change-log') as ReturnType<typeof changeLogFactory>;

  const referenceOf = (value: unknown): string => {
    if (typeof value !== 'string' || !REFERENCE.test(value.trim())) {
      throw invalid('reference', 'bank reference must be 4–41 letters, digits or hyphens');
    }
    return value.trim();
  };

  const amountOf = (value: unknown): number => {
    if (typeof value !== 'number') throw invalid('amount', 'amount must be a positive integer');
    const amount = assertSafeAmount(value, 'amount');
    if (amount <= 0) throw invalid('amount', 'amount must be a positive integer');
    return amount;
  };

  const transferredAtOf = (value: unknown, ctx: ServiceContext): string => {
    if (value === undefined || value === null || value === '') return nowOf(ctx).toISOString();
    if (typeof value !== 'string' || Number.isNaN(new Date(value).getTime())) {
      throw invalid('transferredAt', 'transferredAt is not a valid time');
    }
    return new Date(value).toISOString();
  };

  const reasonOf = (value: unknown): string | undefined => {
    if (value === undefined || value === null || value === '') return undefined;
    if (typeof value !== 'string') throw invalid('note', 'note must be text');
    const reason = value.trim();
    if (reason.length > MAX_NOTE) throw invalid('note', 'note is too long');
    return reason.length > 0 ? reason : undefined;
  };

  return {
    /**
     * POST /orders/:id/manual-payments. Out of scope is 404. A reference that already exists
     * is 400. The unique-violation catch stays outside the transaction: a 23505 inside aborts it.
     */
    async record(
      orderId: number,
      input: { reference: unknown; amount: unknown; transferredAt: unknown; note: unknown },
      ctx: ServiceContext,
    ): Promise<{ eventId: number; paymentId: number; reviewStatus: string; confirmed: false }> {
      const reference = referenceOf(input.reference);
      const amount = amountOf(input.amount);
      const transferredAt = transferredAtOf(input.transferredAt, ctx);
      const reason = reasonOf(input.note);
      const preview = await order().getOrder(orderId, ctx);
      try {
        return await strapi.db.transaction(async () => {
          const recorded = await matching().recordManual(
            {
              orderId,
              reference,
              amount,
              currency: preview.order.currency,
              transferredAt,
            },
            ctx,
          );
          await changeLog().record(
            {
              action: 'payment-manual.record',
              entityType: 'payment-event',
              entityId: recorded.eventId,
              locationRef: preview.order.locationRef,
              entityLabel: preview.order.code,
              orderId,
              after: { reference, amount, ...(reason ? { reason } : {}) },
            },
            ctx,
          );
          return { ...recorded, confirmed: false as const };
        });
      } catch (error) {
        if (!isUniqueViolation(error)) throw error;
        throw invalid('reference', 'bank reference already recorded');
      }
    },
  };
};

export default manualPayment;
