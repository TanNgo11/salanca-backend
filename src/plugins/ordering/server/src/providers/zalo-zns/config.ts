import { z } from '@strapi/utils';

import { parseProviderSettings } from '../_config';

/**
 * Zalo ZNS settings (docs/providers/zalo-zns.md). Either a static `accessToken` or the OAuth
 * triple (appId + appSecret + refreshToken) so the adapter can refresh itself. ZNS stays off
 * until the OA template is approved — the channel-rule `templateId` is what makes a send real.
 */
export const zaloSettingsSchema = z.object({
  enabled: z.literal(true),
  accessToken: z.string().min(1).max(512).optional(),
  appId: z.string().min(1).max(64).optional(),
  appSecret: z.string().min(1).max(128).optional(),
  refreshToken: z.string().min(1).max(512).optional(),
  baseUrl: z.string().url().default('https://business.openapi.zalo.me'),
  oauthUrl: z.string().url().default('https://oauth.zaloapp.com/v4/oa/access_token'),
});

export type ZaloSettings = z.infer<typeof zaloSettingsSchema>;

export const parseZaloSettings = (raw: unknown): ZaloSettings | null =>
  parseProviderSettings('providers.notification.zalo', zaloSettingsSchema, raw, [
    (settings) =>
      settings.accessToken === undefined &&
      !(settings.appId && settings.appSecret && settings.refreshToken)
        ? 'needs accessToken, or all of appId + appSecret + refreshToken'
        : null,
  ]);
