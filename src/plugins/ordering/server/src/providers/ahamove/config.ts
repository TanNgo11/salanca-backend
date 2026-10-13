import { z } from '@strapi/utils';

import { parseProviderSettings } from '../_config';

/**
 * Ahamove v3 settings (docs/providers/ahamove.md). Authenticate needs `mobile` + `apiKey`;
 * `token` skips the token call entirely. `webhookToken` is the shared `apikey` header the
 * carrier must send — required up front so a carrier update can never arrive unauthenticated.
 */
export const ahamoveSettingsSchema = z.object({
  enabled: z.literal(true),
  apiKey: z.string().min(1).max(128),
  mobile: z.string().min(9).max(20).optional(),
  token: z.string().min(1).max(512).optional(),
  name: z.string().min(1).max(120).optional(),
  environment: z.enum(['staging', 'production']).default('staging'),
  baseUrl: z.string().url().optional(),
  webhookToken: z.string().min(16).max(128),
  serviceId: z.string().min(1).max(64).default('SGN-BIKE'),
  paymentMethod: z.string().min(1).max(32).default('CASH'),
  /** Extra request objects merged into create (e.g. COD/bulky packages per docs). */
  requests: z.array(z.looseObject({ _id: z.string().min(1) })).default([]),
  /** 'zone' keeps branch-zone fees as the customer price; 'carrier' quotes Ahamove instead. */
  feeSource: z.enum(['zone', 'carrier']).default('zone'),
});

export type AhamoveSettings = z.infer<typeof ahamoveSettingsSchema>;

export const AHAMOVE_BASE_URLS: Record<AhamoveSettings['environment'], string> = {
  staging: 'https://partner-apistg.ahamove.com',
  production: 'https://partner-api.ahamove.com',
};

export const ahamoveBaseUrl = (settings: AhamoveSettings): string =>
  settings.baseUrl ?? AHAMOVE_BASE_URLS[settings.environment];

export const parseAhamoveSettings = (raw: unknown): AhamoveSettings | null =>
  parseProviderSettings('providers.fulfillment.ahamove', ahamoveSettingsSchema, raw, [
    (settings) =>
      settings.token === undefined && settings.mobile === undefined
        ? 'mobile is required when token is not configured (authenticate needs mobile + apiKey)'
        : null,
  ]);
