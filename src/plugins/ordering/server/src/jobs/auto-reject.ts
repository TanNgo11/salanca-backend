import type { Core } from '@strapi/strapi';

import { autoRejectMinutes, receiveKindKey } from '../domain/branch-settings';
import { isTerminal } from '../domain/workflow/transition';
import type { TransactionClient } from '../migrations/runner';
import type branchFactory from '../services/branch';
import type { ServiceContext } from '../services/context';
import type jobLockFactory from '../services/job-lock';
import type refundFactory from '../services/refund';
import type { OrderingRegistry } from '../services/registry';
import type transitionFactory from '../services/transition';

/**
 * O12 `auto-reject`: a group still in `awaiting-acceptance` past the branch's per-kind
 * `autoRejectAfterMinutes` is rejected automatically — the held payment is refunded (cash
 * settles now, transfers stay `pending`) and the customer gets the order-rejected email via
 * the normal outbox path. Groups leave `awaiting-acceptance` on success, so re-runs are
 * no-ops; a staff accept racing the job throws inside the transaction and that order is
 * skipped. Serialized across instances by the job lock.
 */
export const runAutoReject = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; rejected: number; skipped: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const branches = plugin.service('branch') as ReturnType<typeof branchFactory>;
  const transition = plugin.service('transition') as ReturnType<typeof transitionFactory>;
  const refund = plugin.service('refund') as ReturnType<typeof refundFactory>;
  const registry = plugin.service('registry') as OrderingRegistry;
  const now = options.now ?? new Date();
  const ctx: ServiceContext = { actor: { kind: 'system', actorRef: 'job:auto-reject' }, now };

  const outcome = await jobLock.withLock(
    { jobName: 'auto-reject', owner: options.owner, now },
    async () => {
      const waiting = (await strapi.db.query('plugin::ordering.fulfillment-group').findMany({
        where: { status: 'awaiting-acceptance' },
        populate: {
          order: { select: ['id', 'code', 'placedAt', 'locationRef', 'status', 'receiveMethod'] },
        },
        limit: 500,
      })) as Array<{
        order: {
          id: number;
          code: string;
          placedAt: string;
          locationRef: string;
          status: string;
          receiveMethod: { kind?: string } | null;
        } | null;
      }>;
      // One decision per order (an order can hold several awaiting groups); the timeout is
      // cached per branch+kind so a busy branch is resolved once per run.
      type Pending = { orderId: number; placedAt: string; minutes: number };
      const pending = new Map<number, Pending>();
      const timeouts = new Map<string, number>();
      for (const group of waiting) {
        const order = group.order;
        if (!order || order.status !== 'open' || pending.has(order.id)) continue;
        const kind = receiveKindKey(order.receiveMethod?.kind ?? 'pickup') ?? 'pickup';
        const cacheKey = `${order.locationRef}:${kind}`;
        let minutes = timeouts.get(cacheKey);
        if (minutes === undefined) {
          const branch = await branches.findByCode(order.locationRef);
          const settings =
            kind === 'delivery'
              ? branches.deliverySettings(branch ?? { fulfillment: null })
              : kind === 'dineIn'
                ? branches.dineInSettings(branch ?? { fulfillment: null })
                : branches.pickupSettings(branch ?? { fulfillment: null });
          minutes = autoRejectMinutes(settings) ?? 0;
          timeouts.set(cacheKey, minutes);
        }
        pending.set(order.id, { orderId: order.id, placedAt: order.placedAt, minutes });
      }

      let rejected = 0;
      let skipped = 0;
      for (const item of pending.values()) {
        if (item.minutes <= 0) continue;
        if (now.getTime() - new Date(item.placedAt).getTime() <= item.minutes * 60_000) continue;
        try {
          await strapi.db.transaction(async ({ trx }: { trx: TransactionClient }) => {
            // Re-read inside the transaction: staff may have accepted between the scan and
            // this point — only groups still waiting are rejected.
            const groups = (await strapi.db.query('plugin::ordering.fulfillment-group').findMany({
              where: { order: item.orderId, status: 'awaiting-acceptance' },
            })) as Array<{
              id: number;
              status: string;
              workflowName: string;
              workflowVersion: string;
            }>;
            for (const group of groups) {
              const definition = registry.workflow(group.workflowName, group.workflowVersion);
              if (isTerminal(definition, group.status) !== null) continue;
              const to = definition.states[group.status]?.next.includes('rejected')
                ? 'rejected'
                : definition.cancelState;
              await transition.transitionGroup(
                {
                  orderId: item.orderId,
                  groupId: group.id,
                  to,
                  reason: 'no-response',
                  payload: { autoRejected: true },
                },
                ctx,
              );
            }
            await refund.refundHeldForOrder(trx, item.orderId, 'no-response', ctx);
          });
          rejected += 1;
        } catch {
          // Staff acted first or a workflow rejected the step — leave the order alone.
          skipped += 1;
        }
      }
      return { rejected, skipped };
    },
  );
  return outcome.ran ? { ran: true, ...outcome.result } : { ran: false, rejected: 0, skipped: 0 };
};
