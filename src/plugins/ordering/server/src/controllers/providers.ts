import type { Core } from '@strapi/strapi';

import type providerStatusFactory from '../services/provider-status';
import { adminAction } from './http';

type ProviderStatusService = ReturnType<typeof providerStatusFactory>;

/** O13 "Nhà cung cấp" (screens P1): read-only integration overview, `settings.manage` only. */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = () =>
    strapi.plugin('ordering').service('provider-status') as ProviderStatusService;

  return {
    /** GET /ordering/providers — grouped provider cards (masked ids, no secrets). */
    list: adminAction(strapi, async () => service().overview()),
  };
};
