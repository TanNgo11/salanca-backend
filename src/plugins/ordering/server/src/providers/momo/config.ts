import { z } from '@strapi/utils';

import { parseProviderSettings } from '../_config';

/**
 * MoMo AIO v2 settings (docs/providers/momo.md). Env-only secrets; the provider registers
 * only when the schema parses. `baseUrl` overrides `environment` — the fake-server scripts
 * point it at 127.0.0.1.
 */
export const momoSettingsSchema = z.object({
  enabled: z.literal(true),
  partnerCode: z.string().min(1).max(64),
  accessKey: z.string().min(1).max(128),
  secretKey: z.string().min(1).max(128),
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
  baseUrl: z.string().url().optional(),
  requestType: z.string().min(1).max(64).default('captureWallet'),
});

export type MomoSettings = z.infer<typeof momoSettingsSchema>;

export const MOMO_BASE_URLS: Record<MomoSettings['environment'], string> = {
  sandbox: 'https://test-payment.momo.vn',
  production: 'https://payment.momo.vn',
};

export const momoBaseUrl = (settings: MomoSettings): string =>
  settings.baseUrl ?? MOMO_BASE_URLS[settings.environment];

export const parseMomoSettings = (raw: unknown): MomoSettings | null =>
  parseProviderSettings('providers.payment.momo', momoSettingsSchema, raw);
