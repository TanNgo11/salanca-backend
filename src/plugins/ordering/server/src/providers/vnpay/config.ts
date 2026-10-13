import { z } from '@strapi/utils';

import { parseProviderSettings } from '../_config';

/**
 * VNPay PAY v2.1.0 settings (docs/providers/vnpay.md). `baseUrl` is the gateway host
 * (e.g. `https://sandbox.vnpayment.vn`); pay/query/refund paths are appended by the adapter,
 * which keeps the fake-server override to one env var.
 */
export const vnpaySettingsSchema = z.object({
  enabled: z.literal(true),
  tmnCode: z.string().min(1).max(32),
  hashSecret: z.string().min(8).max(128),
  environment: z.enum(['sandbox', 'production']).default('sandbox'),
  baseUrl: z.string().url().optional(),
  locale: z.string().min(2).max(8).default('vn'),
  orderType: z.string().min(1).max(32).default('other'),
  createBy: z.string().min(1).max(64).default('ordering'),
});

export type VnpaySettings = z.infer<typeof vnpaySettingsSchema>;

export const VNPAY_BASE_URLS: Record<VnpaySettings['environment'], string> = {
  sandbox: 'https://sandbox.vnpayment.vn',
  production: 'https://payment.vnpayment.vn',
};

export const vnpayBaseUrl = (settings: VnpaySettings): string =>
  settings.baseUrl ?? VNPAY_BASE_URLS[settings.environment];

export const parseVnpaySettings = (raw: unknown): VnpaySettings | null =>
  parseProviderSettings('providers.payment.vnpay', vnpaySettingsSchema, raw);
