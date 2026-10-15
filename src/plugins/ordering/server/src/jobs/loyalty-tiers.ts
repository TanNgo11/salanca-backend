import type { Core } from '@strapi/strapi';

import type jobLockFactory from '../services/job-lock';
import type loyaltyLifecycleFactory from '../services/loyalty-lifecycle';

/**
 * Daily tier review (O16 step 5): recomputes each customer's 12-month spend and moves the tier — up
 * at once, down after the grace period — keeping the O14 group in step. Serialized across instances by
 * the job lock; idempotent.
 */
export const runLoyaltyTiers = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; checked: number; up: number; down: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const lifecycle = plugin.service('loyalty-lifecycle') as ReturnType<typeof loyaltyLifecycleFactory>;
  const now = options.now ?? new Date();
  const outcome = await jobLock.withLock({ jobName: 'loyalty-tiers', owner: options.owner, now }, () =>
    lifecycle.refreshTiers(now),
  );
  return outcome.ran ? { ran: true, ...outcome.result } : { ran: false, checked: 0, up: 0, down: 0 };
};
