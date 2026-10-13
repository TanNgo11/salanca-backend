import type { Core } from '@strapi/strapi';

import type jobLockFactory from '../services/job-lock';

type CartExpiryResult = { ran: boolean; expired: number; deleted: number };

type CartService = {
  expireDue: (now: Date) => Promise<{ expired: number; deleted: number }>;
};

/**
 * `cart-expiry` (O11 step 4): active carts past their sliding `expiresAt` flip to `expired`;
 * `expired`/`converted` rows are hard-deleted `carts.expiredDeleteDays` after expiry. Bounded
 * batches inside the lock; a rerun with nothing due is a no-op.
 */
export const runCartExpiry = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<CartExpiryResult> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const now = options.now ?? new Date();
  const outcome = await jobLock.withLock(
    { jobName: 'cart-expiry', owner: options.owner, now },
    async () => {
      const service = plugin.service('cart') as unknown as CartService;
      const result = await service.expireDue(now);
      if (result.expired > 0 || result.deleted > 0) {
        strapi.log.info(`[ordering] cart-expiry expired=${result.expired} deleted=${result.deleted}`);
      }
      return result;
    },
  );
  return outcome.ran
    ? { ran: true, ...(outcome.result as Omit<CartExpiryResult, 'ran'>) }
    : { ran: false, expired: 0, deleted: 0 };
};
