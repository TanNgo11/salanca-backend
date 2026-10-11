import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';

import { OrderingError } from '../domain/errors';
import type changeLogFactory from './change-log';
import type { ServiceContext } from './context';

/**
 * General sales settings (screens S9), stored in the plugin's core store. Branch-level settings
 * live on `branch`; these apply to every branch's Admin inbox.
 */
const reason = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/),
  label: z.record(z.string(), z.string().max(80)),
});

export const settingsSchema = z.object({
  newOrderDialog: z.boolean().default(true),
  soundByDefault: z.boolean().default(true),
  rejectReasons: z
    .array(reason)
    .max(20)
    .default([
      { code: 'out-of-stock', label: { vi: 'Hết món', en: 'Out of stock' } },
      { code: 'overloaded', label: { vi: 'Quá tải', en: 'Too busy' } },
      { code: 'closed', label: { vi: 'Ngoài giờ', en: 'Outside opening hours' } },
      { code: 'unreachable', label: { vi: 'Không liên lạc được khách', en: 'Customer unreachable' } },
    ]),
  delayMinutes: z.array(z.number().int().min(1).max(240)).max(6).default([10, 20, 30]),
});

export type OrderingSettings = z.infer<typeof settingsSchema>;

const orderingSettings = ({ strapi }: { strapi: Core.Strapi }) => {
  const store = () => strapi.store({ type: 'plugin', name: 'ordering', key: 'settings' });
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  return {
    async get(): Promise<OrderingSettings> {
      const parsed = settingsSchema.safeParse((await store().get({})) ?? {});
      return parsed.success ? parsed.data : settingsSchema.parse({});
    },

    async put(raw: unknown, ctx: ServiceContext): Promise<OrderingSettings> {
      const parsed = settingsSchema.safeParse(raw);
      if (!parsed.success) {
        throw new OrderingError('VALIDATION_ERROR', 'settings are invalid', {
          details: {
            issues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
          },
        });
      }
      const codes = parsed.data.rejectReasons.map((item) => item.code);
      if (new Set(codes).size !== codes.length) {
        throw new OrderingError('VALIDATION_ERROR', 'settings are invalid', {
          details: { issues: [{ path: 'rejectReasons', message: 'reason codes must be unique' }] },
        });
      }
      const before = await this.get();
      await store().set({ value: parsed.data });
      await changeLog().record(
        {
          action: 'settings.update',
          entityType: 'settings',
          entityId: 'ordering',
          before: before as unknown as Record<string, unknown>,
          after: parsed.data as unknown as Record<string, unknown>,
        },
        ctx,
      );
      return parsed.data;
    },
  };
};

export default orderingSettings;
