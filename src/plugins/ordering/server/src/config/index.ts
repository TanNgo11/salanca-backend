import { z } from '@strapi/utils';

/** Settings of one registered provider. Provider-specific keys are validated by the provider itself. */
const providerSettings = z.looseObject({ enabled: z.boolean() });

const taxRate = z.object({
  ratePercent: z.number().min(0),
  validFrom: z.string().min(1),
  validTo: z.string().min(1).optional(),
});

/**
 * Provider and product-type maps are objects keyed by code, never arrays: Strapi merges the plugin
 * default with the app config through `defaultsDeep`, which merges arrays index by index.
 */
export const configSchema = z.object({
  currency: z.literal('VND'),
  catalog: z.object({ adapter: z.string().min(1), defaultLocale: z.string().min(2) }),
  allowMixedProductTypes: z.boolean(),
  orderCode: z.object({ template: z.string().min(1), prefix: z.string().min(1) }),
  consent: z.object({ policyVersion: z.string().min(1) }),
  businessDay: z.object({
    cutoffLocalTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
  tax: z.object({
    enabled: z.boolean(),
    pricesIncludeTax: z.boolean(),
    defaultCategory: z.string().min(1),
    categories: z.record(
      z.string(),
      z.object({ label: z.string().min(1), rates: z.array(taxRate) }),
    ),
  }),
  hold: z.object({ defaultMinutes: z.number().int().positive() }),
  idempotency: z.object({ ttlHours: z.number().int().positive() }),
  outbox: z.object({
    batchSize: z.number().int().positive(),
    leaseSeconds: z.number().int().positive(),
    maxAttempts: z.number().int().positive(),
    baseBackoffSeconds: z.number().int().positive(),
    maxBackoffSeconds: z.number().int().positive(),
  }),
  jobs: z.object({
    enabled: z.boolean(),
    outboxCron: z.string().min(1),
    holdExpiryCron: z.string().min(1),
    idempotencyCleanupCron: z.string().min(1),
  }),
  testing: z.object({ builtins: z.boolean() }).refine(
    (value) => !value.builtins || process.env.NODE_ENV !== 'production',
    'testing.builtins is forbidden when NODE_ENV=production',
  ),
  productTypes: z.record(z.string(), providerSettings),
  providers: z.object({
    payment: z.record(z.string(), providerSettings),
    fulfillment: z.record(z.string(), providerSettings),
    scheduling: z.record(z.string(), providerSettings),
    voucher: z.record(z.string(), providerSettings),
    captcha: z.record(z.string(), providerSettings),
  }),
});

export type OrderingConfig = z.infer<typeof configSchema>;

export default {
  default: {
    currency: 'VND',
    catalog: { adapter: 'ordering-catalog', defaultLocale: 'vi' },
    allowMixedProductTypes: false,
    orderCode: { template: '{prefix}-{seq:6}', prefix: 'ORD' },
    consent: { policyVersion: 'v1' },
    businessDay: { cutoffLocalTime: '04:00' },
    tax: {
      enabled: false,
      pricesIncludeTax: true,
      defaultCategory: 'standard',
      categories: {},
    },
    hold: { defaultMinutes: 15 },
    idempotency: { ttlHours: 24 },
    outbox: {
      batchSize: 50,
      leaseSeconds: 300,
      maxAttempts: 10,
      baseBackoffSeconds: 30,
      maxBackoffSeconds: 3600,
    },
    jobs: {
      enabled: true,
      outboxCron: '*/10 * * * * *',
      holdExpiryCron: '*/30 * * * * *',
      idempotencyCleanupCron: '0 */15 * * * *',
    },
    testing: { builtins: false },
    productTypes: {},
    providers: { payment: {}, fulfillment: {}, scheduling: {}, voucher: {}, captcha: {} },
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
