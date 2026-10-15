import { z } from '@strapi/utils';

import { OrderingError } from '../errors';

/** Receive kinds that can earn points. Digital (gift card) and appointment orders never do. */
export const LOYALTY_CHANNELS = ['pickup', 'delivery', 'dine-in'] as const;

/**
 * The loyalty program (O16), stored in the plugin core store under `loyalty`. Defaults are the
 * owner's 2026-10-13 decisions; `enabled` stays false until the owner opens the program.
 * `startsAt` is written by the service the first time the program is switched on and is not
 * accepted from the Admin body: only orders completed after it earn points (no back-dating).
 */
export const loyaltySettingsSchema = z.object({
  enabled: z.boolean().default(false),
  startsAt: z.string().nullable().default(null),
  earnPerAmount: z.number().int().min(1).max(10_000_000).default(10_000),
  pointValue: z.number().int().min(1).max(1_000_000).default(100),
  minRedeemPoints: z.number().int().min(1).max(100_000).default(50),
  maxRedeemShare: z.number().min(0.01).max(1).default(0.5),
  expiryMonths: z.number().int().min(1).max(60).default(12),
  expiryReminderDays: z.number().int().min(0).max(90).default(14),
  downgradeGraceDays: z.number().int().min(0).max(365).default(30),
  dailyEarnCap: z.number().int().min(1).max(10_000_000).default(2000),
  channels: z.array(z.enum(LOYALTY_CHANNELS)).max(3).default([...LOYALTY_CHANNELS]),
  countHistoryForTiers: z.boolean().default(true),
});

export type LoyaltySettings = z.infer<typeof loyaltySettingsSchema>;

export const DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = loyaltySettingsSchema.parse({});

/** The fields an Admin body may set (everything but the service-owned `startsAt`). */
export const loyaltySettingsInputSchema = loyaltySettingsSchema.omit({ startsAt: true }).strict();

const fail = (path: string, message: string): never => {
  throw new OrderingError('VALIDATION_ERROR', 'loyalty settings are invalid', {
    details: { issues: [{ path, message }] },
  });
};

export const parseLoyaltySettingsInput = (raw: unknown): Omit<LoyaltySettings, 'startsAt'> => {
  const parsed = loyaltySettingsInputSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return fail(issue?.path.join('.') || 'settings', issue?.message ?? 'invalid');
  }
  const data = parsed.data;
  if (new Set(data.channels).size !== data.channels.length) fail('channels', 'channels must be unique');
  return data;
};

const localizedName = z
  .object({
    vi: z.string().trim().min(1).max(120),
    en: z.string().trim().max(120).optional(),
  })
  .strict();

export const tierInputSchema = z
  .object({
    code: z.string().regex(/^[a-z0-9-]{2,40}$/, 'lowercase letters, digits and dashes (2–40)'),
    name: localizedName,
    minSpend12m: z.number().int().min(0).max(10_000_000_000),
    /** ×100: 100 = ×1.0. */
    multiplier: z.number().int().min(10).max(1000),
    customerGroupCode: z.string().trim().min(1).max(64).nullable().default(null),
    active: z.boolean().default(true),
  })
  .strict();

export type TierInput = z.infer<typeof tierInputSchema>;

export const parseTierInput = (raw: unknown): TierInput => {
  const parsed = tierInputSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new OrderingError('VALIDATION_ERROR', 'loyalty tier is invalid', {
      details: { issues: [{ path: issue?.path.join('.') || 'tier', message: issue?.message ?? 'invalid' }] },
    });
  }
  return parsed.data;
};

/** Tiers a fresh program starts with (decision 2026-10-13). The base tier carries no group. */
export const DEFAULT_TIERS: Array<TierInput> = [
  {
    code: 'thanh-vien',
    name: { vi: 'Thành viên', en: 'Member' },
    minSpend12m: 0,
    multiplier: 100,
    customerGroupCode: null,
    active: true,
  },
  {
    code: 'bac',
    name: { vi: 'Bạc', en: 'Silver' },
    minSpend12m: 2_000_000,
    multiplier: 120,
    customerGroupCode: 'hang-bac',
    active: true,
  },
  {
    code: 'vang',
    name: { vi: 'Vàng', en: 'Gold' },
    minSpend12m: 5_000_000,
    multiplier: 150,
    customerGroupCode: 'hang-vang',
    active: true,
  },
];

/** Groups created with the default tiers; no price list is attached (the shop adds that). */
export const DEFAULT_TIER_GROUPS = [
  { code: 'hang-bac', name: { vi: 'Hạng Bạc', en: 'Silver tier' } },
  { code: 'hang-vang', name: { vi: 'Hạng Vàng', en: 'Gold tier' } },
] as const;
