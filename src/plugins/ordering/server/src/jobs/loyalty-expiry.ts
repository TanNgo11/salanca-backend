import type { Core } from '@strapi/strapi';

import type jobLockFactory from '../services/job-lock';
import type loyaltyLifecycleFactory from '../services/loyalty-lifecycle';

/**
 * Daily loyalty lot sweep (O16 step 5): lots past their date are written off with an `expire`
 * ledger row, then customers whose lots expire within the reminder window get ONE mail per lot.
 * Serialized across instances by the job lock; reruns are no-ops (empty lots leave the worklist,
 * reminded lots carry `reminderSentAt`).
 */
export const runLoyaltyExpiry = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<{ ran: boolean; expired: number; points: number; reminded: number }> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const lifecycle = plugin.service('loyalty-lifecycle') as ReturnType<typeof loyaltyLifecycleFactory>;
  const now = options.now ?? new Date();
  const outcome = await jobLock.withLock({ jobName: 'loyalty-expiry', owner: options.owner, now }, async () => {
    const expiry = await lifecycle.expireDue(now);
    const reminders = await lifecycle.remindDue(now);
    return { expired: expiry.expired, points: expiry.points, reminded: reminders.sent };
  });
  return outcome.ran ? { ran: true, ...outcome.result } : { ran: false, expired: 0, points: 0, reminded: 0 };
};
