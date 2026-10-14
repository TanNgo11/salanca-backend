import { z } from '@strapi/utils';

import { parseProviderSettings } from '../_config';

/**
 * eSMS.vn settings (docs/providers/sms-esms.md). `brandname` is required for every SmsType
 * except 8 (fixed cheap SMS without a sender name). `sandbox: true` makes eSMS accept but not
 * send — useful for UAT wiring, never the default.
 */
export const esmsSettingsSchema = z.object({
  enabled: z.literal(true),
  apiKey: z.string().min(1).max(128),
  secretKey: z.string().min(1).max(128),
  brandname: z.string().min(1).max(32).optional(),
  smsType: z.enum(['2', '4', '6', '8', '10']).default('2'),
  isUnicode: z.boolean().default(true),
  sandbox: z.boolean().default(false),
  campaign: z.string().min(1).max(64).optional(),
  baseUrl: z.string().url().default('https://rest.esms.vn'),
});

export type EsmsSettings = z.infer<typeof esmsSettingsSchema>;

export const parseEsmsSettings = (raw: unknown): EsmsSettings | null =>
  parseProviderSettings('providers.notification.sms', esmsSettingsSchema, raw, [
    (settings) =>
      settings.smsType !== '8' && settings.brandname === undefined
        ? 'brandname is required for this SmsType (only SmsType=8 sends without a brandname)'
        : null,
  ]);
