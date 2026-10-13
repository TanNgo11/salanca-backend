import { z } from '@strapi/utils';

import { parseSepaySettings } from '../providers/sepay/config';

/** Settings of one registered provider. Provider-specific keys are validated by the provider itself. */
const providerSettings = z.looseObject({ enabled: z.boolean() });

const rateWindow = z.object({
  max: z.number().int().positive(),
  windowMs: z.number().int().positive(),
});

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
    slaCheckCron: z.string().min(1),
    reconciliationCron: z.string().min(1),
    paymentExpiryCron: z.string().min(1),
    manualConfirmCron: z.string().min(1),
    opsCheckCron: z.string().min(1),
    retentionCron: z.string().min(1),
    auditChainCron: z.string().min(1),
    webhookDispatcherCron: z.string().min(1),
    /** Expected run period in minutes per job for `job-heartbeat-missed` (ops-check). */
    heartbeatMinutes: z.record(z.string(), z.number().int().positive()),
  }),
  /** Data retention windows for the `retention` job (contracts §19.9). */
  retention: z.object({
    paymentPayloadDays: z.number().int().positive(),
    outboxDeliveredDays: z.number().int().positive(),
    outboxFailedDays: z.number().int().positive(),
    alertResolvedDays: z.number().int().positive(),
    /** Rating comments older than this are cleared; the stars stay. */
    ratingCommentDays: z.number().int().positive(),
    batchSize: z.number().int().positive(),
    maxBatchesPerRun: z.number().int().positive(),
  }),
  /** O15 change-log tamper evidence: hash chain filled after commit + verification sample. */
  audit: z.object({
    hashChain: z.boolean(),
    /** Rows newer than this are left for the next run (a slow transaction may still commit). */
    settleSeconds: z.number().int().min(0),
    batchSize: z.number().int().positive(),
    maxBatchesPerRun: z.number().int().positive(),
    verifyRecent: z.number().int().min(0),
    verifySample: z.number().int().min(0),
  }),
  /** Trusted visitor-IP forwarding for rate limits / captcha (domain/client-ip.ts). */
  clientIp: z.object({
    sharedSecret: z.string().optional(),
    secretHeader: z.string().min(1),
    ipHeader: z.string().min(1),
  }),
  /** AES-256-GCM key (32 bytes, base64) for secrets read back later (contracts §21.10). */
  encryptionKey: z.string().optional(),
  /** O10: outbound signed webhooks. */
  webhooks: z.object({
    /** Dev/test only — production endpoints must stay https-only. */
    allowHttp: z.boolean(),
    /** Hostnames exempt from the private-address block (local test receivers). */
    allowHosts: z.array(z.string()),
    timeoutMs: z.number().int().positive(),
    /** Response body is read at most this many bytes, then discarded (never stored). */
    maxResponseBytes: z.number().int().positive(),
    /** Previous secret keeps signing this long after rotation. */
    rotationGraceHours: z.number().int().positive(),
    /** Consecutive delivery failures before an endpoint auto-disables + alerts. */
    disableAfterFailures: z.number().int().positive(),
    /** Attempts per delivery before it is marked failed (schedule is fixed in code). */
    maxAttempts: z.number().int().positive(),
    batchSize: z.number().int().positive(),
    leaseSeconds: z.number().int().positive(),
    /** Deliveries handled per dispatcher run (jobs stay short). */
    maxBatchesPerRun: z.number().int().positive(),
  }),
  notifications: z.object({
    /** Sends through the app's Strapi email plugin; off = deliveries are logged as skipped. */
    email: z.object({ enabled: z.boolean() }),
    /** Customer order link; `{token}` is replaced (put it after `#`, contracts §11). */
    orderLinkTemplate: z.string(),
  }),
  storefront: z.object({
    /** Registered CaptchaProvider code; empty string disables captcha (dev/test only). */
    captchaProvider: z.string(),
    rateLimits: z.object({
      read: rateWindow,
      quote: rateWindow,
      create: rateWindow,
      lookup: rateWindow,
      lookupPerCode: rateWindow,
    }),
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
      slaCheckCron: '0 * * * * *',
      reconciliationCron: '0 0 * * * *',
      paymentExpiryCron: '*/30 * * * * *',
      manualConfirmCron: '0 15 * * * *',
      opsCheckCron: '0 * * * * *',
      retentionCron: '0 30 3 * * *',
      auditChainCron: '0 */5 * * * *',
      webhookDispatcherCron: '*/15 * * * * *',
      heartbeatMinutes: {
        outbox: 2,
        'hold-expiry': 2,
        'payment-expiry': 2,
        'sla-check': 3,
        'idempotency-cleanup': 45,
        'sepay-reconciliation': 150,
        'manual-payment-check': 150,
        retention: 1500,
        'audit-chain': 15,
        'webhook-dispatcher': 2,
      },
    },
    audit: {
      hashChain: true,
      settleSeconds: 30,
      batchSize: 1000,
      maxBatchesPerRun: 20,
      verifyRecent: 2000,
      verifySample: 200,
    },
    // Defaults pending legal confirmation (contracts §19.9).
    retention: {
      paymentPayloadDays: 180,
      outboxDeliveredDays: 30,
      outboxFailedDays: 90,
      alertResolvedDays: 90,
      ratingCommentDays: 365,
      batchSize: 500,
      maxBatchesPerRun: 20,
    },
    webhooks: {
      allowHttp: false,
      allowHosts: [],
      timeoutMs: 10_000,
      maxResponseBytes: 4 * 1024,
      rotationGraceHours: 24,
      disableAfterFailures: 50,
      maxAttempts: 10,
      batchSize: 20,
      leaseSeconds: 60,
      maxBatchesPerRun: 5,
    },
    clientIp: { secretHeader: 'x-ordering-client-secret', ipHeader: 'x-ordering-client-ip' },
    notifications: { email: { enabled: false }, orderLinkTemplate: '' },
    storefront: {
      captchaProvider: '',
      rateLimits: {
        read: { max: 120, windowMs: 60_000 },
        quote: { max: 60, windowMs: 60_000 },
        create: { max: 10, windowMs: 600_000 },
        lookup: { max: 20, windowMs: 900_000 },
        lookupPerCode: { max: 5, windowMs: 900_000 },
      },
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
    // SePay is optional. When it is enabled the provider schema is strict (secret, accounts).
    parseSepaySettings(result.data.providers.payment.sepay);
  },
};
