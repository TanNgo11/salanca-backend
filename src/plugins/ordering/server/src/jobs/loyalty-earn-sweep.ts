import type { Core } from '@strapi/strapi';

import type jobLockFactory from '../services/job-lock';
import type loyaltyFactory from '../services/loyalty';

const BATCH = 200;
const MAX_BATCHES = 10;

/**
 * Loyalty earn sweep (O16 step 3). Completed orders that no `order.transitioned` event reached —
 * `line-cancel` and the refund paths recompute the projection without enqueueing — and orders whose
 * customer verified after completion still need their points. Each order earns under its own
 * transaction, so one failure never blocks the batch; reruns are no-ops because an order with an
 * `earn` row leaves the worklist. Serialized across instances by the job lock.
 */
export const runLoyaltyEarnSweep = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; earned: number; failed: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const loyalty = plugin.service('loyalty') as ReturnType<typeof loyaltyFactory>;
  const now = options.now ?? new Date();
  const outcome = await jobLock.withLock({ jobName: 'loyalty-earn-sweep', owner: options.owner, now }, async () => {
    let earned = 0;
    let failed = 0;
    const attempted = new Set<number>();
    for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
      const ids = (await loyalty.pendingEarnOrderIds(BATCH, now)).filter((id) => !attempted.has(id));
      if (ids.length === 0) break;
      for (const orderId of ids) {
        attempted.add(orderId);
        try {
          const result = await loyalty.earnForOrder(orderId, { now });
          if (result.status === 'earned') earned += 1;
        } catch (error) {
          failed += 1;
          strapi.log.warn(`[ordering] loyalty-earn-sweep order ${orderId} failed: ${(error as Error).message}`);
        }
      }
    }
    return { earned, failed };
  });
  return outcome.ran ? { ran: true, ...outcome.result } : { ran: false, earned: 0, failed: 0 };
};
