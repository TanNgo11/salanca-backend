import { z } from '@strapi/utils';

/** Settings of one registered provider. Provider-specific keys are validated by the provider itself. */
const providerSettings = z.looseObject({ enabled: z.boolean() });

/**
 * Provider and product-type maps are objects keyed by code, never arrays: Strapi merges the plugin
 * default with the app config through `defaultsDeep`, which merges arrays index by index.
 */
export const configSchema = z.object({
  currency: z.literal('VND'),
  catalog: z.object({ adapter: z.string().min(1), defaultLocale: z.string().min(2) }),
  productTypes: z.record(z.string(), providerSettings),
  providers: z.object({
    payment: z.record(z.string(), providerSettings),
    fulfillment: z.record(z.string(), providerSettings),
    scheduling: z.record(z.string(), providerSettings),
    voucher: z.record(z.string(), providerSettings),
    captcha: z.record(z.string(), providerSettings),
  }),
  spike: z.object({ enabled: z.boolean(), webhookSecret: z.string() }).refine(
    (value) => !value.enabled || value.webhookSecret.length >= 32,
    'enabled spike requires a webhook secret of at least 32 characters',
  ),
});

export type OrderingConfig = z.infer<typeof configSchema>;

export default {
  default: {
    currency: 'VND',
    catalog: { adapter: 'ordering-catalog', defaultLocale: 'vi' },
    productTypes: {},
    providers: { payment: {}, fulfillment: {}, scheduling: {}, voucher: {}, captcha: {} },
    spike: { enabled: false, webhookSecret: '' },
  },
  /** Strapi ignores the return value; it only reacts to a thrown error. */
  validator(config: unknown) {
    const result = configSchema.safeParse(config);
    if (!result.success) {
      throw new Error(
        result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`).join('; '),
      );
    }
  },
};
