import type { Core } from '@strapi/strapi';

import { OrderingError } from '../domain/errors';
import { paymentWindowStart } from '../domain/payments/deadline';
import type branchFactory from '../services/branch';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';
import type paymentLinkFactory from '../services/payment-link';
import type paymentMatchingFactory from '../services/payment-matching';
import type transitionFactory from '../services/transition';

type WaitingGroup = {
  id: number;
  order: {
    id: number;
    placedAt: string;
    locationRef: string;
    status: string;
    receiveMethod: { kind?: string } | null;
  } | null;
};

/**
 * Expires groups still in `awaiting-payment` after the branch payment window. A stored
 * payment-link extension wins when it is later than that window. The transition
 * to `expired` is a cancel terminal, so the group's holds are released with it. A group with
 * nothing left to pay is advanced instead of expired. A transfer
 * that arrives afterwards is `order-closed` and is not captured.
 */
export const runPaymentExpiry = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; expired: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const transition = plugin.service('transition') as ReturnType<typeof transitionFactory>;
  const branches = plugin.service('branch') as ReturnType<typeof branchFactory>;
  const links = plugin.service('payment-link') as ReturnType<typeof paymentLinkFactory>;
  const matching = plugin.service('payment-matching') as ReturnType<typeof paymentMatchingFactory>;
  const now = options.now ?? new Date();
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:payment-expiry' }, now };
  const events = () => strapi.db.query('plugin::ordering.order-event');

  const outcome = await jobLock.withLock(
    { jobName: 'payment-expiry', owner: options.owner, now },
    async () => {
      const waiting = (await strapi.db.query('plugin::ordering.fulfillment-group').findMany({
        where: { status: 'awaiting-payment' },
        populate: {
          order: { select: ['id', 'placedAt', 'locationRef', 'status', 'receiveMethod'] },
        },
        // Oldest first, so a long queue of fresh orders cannot starve the ones already due.
        orderBy: { id: 'asc' },
        limit: 200,
      })) as WaitingGroup[];
      let expired = 0;
      for (const group of waiting) {
        const order = group.order;
        if (!order || order.status !== 'open') continue;
        const branch = await branches.findByCode(order.locationRef);
        const timeout = branches.receiveSettings(
          branch ?? { fulfillment: null },
          order.receiveMethod?.kind ?? 'pickup',
        ).paymentTimeoutMinutes;
        const history = (await events().findMany({
          where: { order: order.id, type: 'fulfillment-group.transitioned' },
        })) as Array<{ occurredAt: string; payload: { groupId?: unknown; to?: unknown } | null }>;
        const start = paymentWindowStart({
          placedAt: new Date(order.placedAt),
          groupId: group.id,
          events: history.map((row) => ({ ...row, type: 'fulfillment-group.transitioned' })),
        });
        const deadline = await links.effectiveDeadline(order.id, start, timeout);
        if (now.getTime() < deadline.getTime()) continue;
        // Paid in full (e.g. before acceptance): move on instead of expiring a paid order.
        if (await matching.advanceIfPaid(order.id, ctx)) continue;
        try {
          await transition.transitionGroup(
            { orderId: order.id, groupId: group.id, to: 'expired', reason: 'payment-timeout' },
            ctx,
          );
          expired += 1;
        } catch (error) {
          if (error instanceof OrderingError && error.code === 'INVALID_TRANSITION') continue;
          throw error;
        }
      }
      return expired;
    },
  );

  if (!outcome.ran) return { ran: false, expired: 0 };
  strapi.log.info(`[ordering] payment expiry expired=${outcome.result}`);
  return { ran: true, expired: outcome.result };
};
