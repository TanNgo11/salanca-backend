import type { Core } from '@strapi/strapi';

import type jobLockFactory from '../services/job-lock';

type CartReminderResult = { ran: boolean; sent: number; failed: number; skipped: number };

type CartService = {
  remindDue: (now: Date) => Promise<{ sent: number; failed: number; skipped: number }>;
};

/**
 * `cart-reminder` (O11 step 5): abandoned carts — active, idle past `carts.reminderIdleHours`,
 * not yet reminded — get one `customer.cart-reminder` mail when the branch opted in, the
 * customer consented to marketing and an email is reachable. `reminderSentAt` stamps the send,
 * so each cart is reminded exactly once.
 */
export const runCartReminder = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<CartReminderResult> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const now = options.now ?? new Date();
  const outcome = await jobLock.withLock(
    { jobName: 'cart-reminder', owner: options.owner, now },
    async () => {
      const service = plugin.service('cart') as unknown as CartService;
      const result = await service.remindDue(now);
      if (result.sent > 0 || result.failed > 0) {
        strapi.log.info(`[ordering] cart-reminder sent=${result.sent} failed=${result.failed}`);
      }
      return result;
    },
  );
  return outcome.ran
    ? { ran: true, ...(outcome.result as Omit<CartReminderResult, 'ran'>) }
    : { ran: false, sent: 0, failed: 0, skipped: 0 };
};
