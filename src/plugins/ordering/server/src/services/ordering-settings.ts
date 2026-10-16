import type { Core } from '@strapi/strapi';
import { z } from '@strapi/utils';

import { OrderingError } from '../domain/errors';
import { issueView } from '../domain/validation-issue';
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

const ratingTag = z.object({
  code: z.string().regex(/^[a-z0-9-]{2,40}$/),
  label: z.record(z.string(), z.string().max(80)),
  sentiment: z.enum(['positive', 'negative']),
});

export const settingsSchema = z.object({
  /**
   * Version of the privacy/consent text customers accept at checkout. Unset = the plugin config
   * default (`consent.policyVersion`); a new value makes every client re-accept (orders sent with
   * the old version fail `CONSENT_REQUIRED`).
   */
  consentPolicyVersion: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, dash and underscore only')
    .optional(),
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
      // O12 auto-reject: the branch never accepted the order before its timeout.
      { code: 'no-response', label: { vi: 'Không phản hồi kịp lúc', en: 'No timely response' } },
    ]),
  delayMinutes: z.array(z.number().int().min(1).max(240)).max(6).default([10, 20, 30]),
  ratingInviteEnabled: z.boolean().default(true),
  ratingInviteDelayMinutes: z.number().int().min(0).max(10080).default(60),
  ratingWindowDays: z.number().int().min(1).max(90).default(7),
  ratingEditHours: z.number().int().min(1).max(168).default(24),
  ratingTags: z
    .array(ratingTag)
    .max(20)
    .default([
      { code: 'tasty', label: { vi: 'Ngon', en: 'Tasty' }, sentiment: 'positive' },
      { code: 'fast', label: { vi: 'Nhanh', en: 'Fast' }, sentiment: 'positive' },
      { code: 'wrong-item', label: { vi: 'Sai món', en: 'Wrong item' }, sentiment: 'negative' },
      { code: 'late', label: { vi: 'Lâu', en: 'Late' }, sentiment: 'negative' },
    ]),
});

export type OrderingSettings = z.infer<typeof settingsSchema>;

/** The consent policy version in force (Admin setting, else config) — the one place callers read it. */
export const currentPolicyVersion = (strapi: Core.Strapi): Promise<string> =>
  (
    strapi.plugin('ordering').service('ordering-settings') as {
      effectivePolicyVersion(): Promise<string>;
    }
  ).effectivePolicyVersion();

const orderingSettings = ({ strapi }: { strapi: Core.Strapi }) => {
  const store = () => strapi.store({ type: 'plugin', name: 'ordering', key: 'settings' });
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;

  const read = async (): Promise<OrderingSettings> => {
    const parsed = settingsSchema.safeParse((await store().get({})) ?? {});
    return parsed.success ? parsed.data : settingsSchema.parse({});
  };

  return {
    get: read,

    /** The consent policy version in force: the Admin setting, else the plugin config default. */
    async effectivePolicyVersion(): Promise<string> {
      const stored = (await read()).consentPolicyVersion;
      if (stored) return stored;
      return (strapi.config.get('plugin::ordering') as { consent: { policyVersion: string } }).consent
        .policyVersion;
    },

    async put(raw: unknown, ctx: ServiceContext): Promise<OrderingSettings> {
      const parsed = settingsSchema.safeParse(raw);
      if (!parsed.success) {
        throw new OrderingError('VALIDATION_ERROR', 'settings are invalid', {
          details: {
            issues: parsed.error.issues.map((issue) => issueView(issue, 'settings')),
          },
        });
      }
      const codes = parsed.data.rejectReasons.map((item) => item.code);
      if (new Set(codes).size !== codes.length) {
        throw new OrderingError('VALIDATION_ERROR', 'settings are invalid', {
          details: { issues: [{ path: 'rejectReasons', message: 'reason codes must be unique', code: 'not_unique' }] },
        });
      }
      const tagCodes = parsed.data.ratingTags.map((item) => item.code);
      if (new Set(tagCodes).size !== tagCodes.length) {
        throw new OrderingError('VALIDATION_ERROR', 'settings are invalid', {
          details: { issues: [{ path: 'ratingTags', message: 'tag codes must be unique', code: 'not_unique' }] },
        });
      }
      const before = await read();
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
