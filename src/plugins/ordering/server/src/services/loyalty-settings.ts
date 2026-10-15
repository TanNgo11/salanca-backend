import type { Core } from '@strapi/strapi';

import {
  DEFAULT_LOYALTY_SETTINGS,
  loyaltySettingsSchema,
  parseLoyaltySettingsInput,
  type LoyaltySettings,
} from '../domain/loyalty/settings';
import type changeLogFactory from './change-log';
import { nowOf, type ServiceContext } from './context';
import type loyaltyTierFactory from './loyalty-tier';

/**
 * Loyalty program settings (O16 step 2, screen Y1), kept in the plugin core store under `loyalty`
 * — separate from the S9 sales settings. The first save that turns the program on stamps `startsAt`
 * (no back-dating) and seeds the default tiers and groups.
 */
const loyaltySettings = ({ strapi }: { strapi: Core.Strapi }) => {
  const store = () => strapi.store({ type: 'plugin', name: 'ordering', key: 'loyalty' });
  const changeLog = () => strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const tiers = () => strapi.plugin('ordering').service('loyalty-tier') as ReturnType<typeof loyaltyTierFactory>;

  const read = async (): Promise<LoyaltySettings> => {
    const parsed = loyaltySettingsSchema.safeParse((await store().get({})) ?? {});
    return parsed.success ? parsed.data : { ...DEFAULT_LOYALTY_SETTINGS };
  };

  return {
    get: read,

    /** True when the program is on and `at` falls on or after `startsAt`. */
    async isOpenAt(at: Date): Promise<boolean> {
      const settings = await read();
      return settings.enabled && (settings.startsAt === null || new Date(settings.startsAt) <= at);
    },

    async put(raw: unknown, ctx: ServiceContext): Promise<LoyaltySettings> {
      const input = parseLoyaltySettingsInput(raw);
      const before = await read();
      const startsAt = before.startsAt ?? (input.enabled ? nowOf(ctx).toISOString() : null);
      const next: LoyaltySettings = { ...input, startsAt };
      await store().set({ value: next });
      if (next.enabled) await tiers().ensureDefaults();
      await changeLog().record(
        {
          action: 'loyalty.settings.update',
          entityType: 'loyalty-settings',
          entityId: 'loyalty',
          before: before as unknown as Record<string, unknown>,
          after: next as unknown as Record<string, unknown>,
        },
        ctx,
      );
      return next;
    },
  };
};

export default loyaltySettings;
