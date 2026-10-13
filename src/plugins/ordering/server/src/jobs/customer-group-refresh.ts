import type { Core } from '@strapi/strapi';

import type jobLockFactory from '../services/job-lock';

type RefreshResult = { ran: boolean; groups: number; added: number; removed: number };

/**
 * `customer-group-refresh` (O14): recomputes automatic group membership in batches.
 * Erased customers are removed and not re-added. Manual members stay.
 */
export const runCustomerGroupRefresh = async (
  strapi: Core.Strapi,
  options: { owner: string; now?: Date },
): Promise<RefreshResult> => {
  const plugin = strapi.plugin('ordering');
  const jobLock = plugin.service('job-lock') as ReturnType<typeof jobLockFactory>;
  const now = options.now ?? new Date();
  const outcome = await jobLock.withLock(
    { jobName: 'customer-group-refresh', owner: options.owner, now },
    async () => {
      const service = plugin.service('customer-group') as {
        refreshAuto(now?: Date): Promise<{ groups: number; added: number; removed: number }>;
      };
      const result = await service.refreshAuto(now);
      if (result.added > 0 || result.removed > 0) {
        strapi.log.info(
          `[ordering] customer-group-refresh groups=${result.groups} added=${result.added} removed=${result.removed}`,
        );
      }
      return result;
    },
  );
  return outcome.ran
    ? { ran: true, ...(outcome.result as Omit<RefreshResult, 'ran'>) }
    : { ran: false, groups: 0, added: 0, removed: 0 };
};
