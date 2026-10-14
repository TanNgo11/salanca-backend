import { z } from '@strapi/utils';

import { parseAhamoveSettings } from '../providers/ahamove/config';
import { parseEsmsSettings } from '../providers/esms/config';
import { parseMomoSettings } from '../providers/momo/config';
import { parseSepaySettings } from '../providers/sepay/config';
import { parseVnpaySettings } from '../providers/vnpay/config';
import { parseZaloSettings } from '../providers/zalo-zns/config';

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
    autoRejectCron: z.string().min(1),
    reconciliationCron: z.string().min(1),
    paymentExpiryCron: z.string().min(1),
    manualConfirmCron: z.string().min(1),
    /** O13: polls wallet providers for pending payments when the IPN never arrives. */
    walletStatusCron: z.string().min(1),
    opsCheckCron: z.string().min(1),
    retentionCron: z.string().min(1),
    auditChainCron: z.string().min(1),
    webhookDispatcherCron: z.string().min(1),
    cartExpiryCron: z.string().min(1),
    cartReminderCron: z.string().min(1),
    dataRequestWaitingCron: z.string().min(1),
    customerGroupRefreshCron: z.string().min(1),
    /** O12: open sessions past business-day end get a `table-session-open` alert. */
    tableSessionAutocloseCron: z.string().min(1),
    /** Expected run period in minutes per job for `job-heartbeat-missed` (ops-check). */
    heartbeatMinutes: z.record(z.string(), z.number().int().positive()),
  }),
  /** Data retention windows for the `retention` job (contracts §19.9). */
  retention: z.object({
    paymentPayloadDays: z.number().int().positive(),
    outboxDeliveredDays: z.number().int().positive(),
    outboxFailedDays: z.number().int().positive(),
    alertResolvedDays: z.number().int().positive(),
    /** O11: OTP rows past expiry, sessions revoked/expired, carts expired/converted. */
    otpDays: z.number().int().positive(),
    sessionDays: z.number().int().positive(),
    cartDays: z.number().int().positive(),
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
    /** O13: paid-channel cap per UTC day; deliveries beyond it fall to the next channel. */
    dailyLimit: z.number().int().positive(),
    /** Estimated per-message cost (VND) by channel — shown on P3, never a billing value. */
    costEstimates: z.record(z.string(), z.number().int().min(0)),
  }),
  /** O12: table QR links. `{token}` is replaced by the table's raw secret. */
  tables: z.object({
    /** Storefront menu URL for a scanned table QR (`{token}` placeholder required). */
    menuUrlTemplate: z.string(),
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
      /** O11: /auth/* (OTP request+verify) and /carts* mutating routes. */
      auth: rateWindow,
      cart: rateWindow,
      promotionCode: rateWindow,
      rating: rateWindow,
    }),
  }),
  /** O11: customer accounts — OTP sign-in, sessions, profile. */
  customers: z.object({
    enabled: z.boolean(),
    /** Channels allowed for OTP delivery ('email' today; 'sms'/'zalo' arrive with O13). */
    otpChannels: z.array(z.string().min(1)).min(1),
    otp: z.object({
      codeMinutes: z.number().int().positive(),
      maxAttempts: z.number().int().positive(),
      /** Max challenges per target inside sendWindowMinutes. */
      sendMax: z.number().int().positive(),
      sendWindowMinutes: z.number().int().positive(),
      /** Max challenges per client IP per hour. */
      ipMaxPerHour: z.number().int().positive(),
    }),
    sessionDays: z.number().int().positive(),
    maxSessions: z.number().int().positive(),
    /** 0 = off: erase profiles with no order activity for this many months (retention job). */
    inactiveErasureMonths: z.number().int().min(0),
  }),
  /** O11: server-side carts (guest token or session). */
  carts: z.object({
    enabled: z.boolean(),
    /** A cart expires this many days after its last activity. */
    expiryDays: z.number().int().positive(),
    /** Expired/converted carts are hard-deleted this many days later (retention). */
    expiredDeleteDays: z.number().int().positive(),
    /** Abandoned-cart reminder fires once the cart idles this long. */
    reminderIdleHours: z.number().positive(),
    maxLines: z.number().int().positive(),
  }),
  /** O11: Decree 13/2023 personal-data requests. */
  dataRights: z.object({
    /** Staff deadline before the request is flagged late (audit + ops alert). */
    deadlineHours: z.number().int().positive(),
  }),
  testing: z.object({ builtins: z.boolean() }).refine(
    (value) => !value.builtins || process.env.NODE_ENV !== 'production',
    'testing.builtins is forbidden when NODE_ENV=production',
  ),
  /**
   * O13: absolute public base of THIS server (e.g. `https://cms.salanca.vn`), used to build
   * wallet IPN/return URLs. Required when momo/vnpay is enabled — enforced in the validator.
   */
  publicApiUrl: z.string(),
  /**
   * Storefront origins (e.g. `https://salanca.vn`) a wallet `returnUrl` may point to. Any other
   * return URL falls back to this server's own return page — no open redirect.
   */
  walletReturnOrigins: z.array(z.string()),
  productTypes: z.record(z.string(), providerSettings),
  providers: z.object({
    payment: z.record(z.string(), providerSettings),
    fulfillment: z.record(z.string(), providerSettings),
    scheduling: z.record(z.string(), providerSettings),
    voucher: z.record(z.string(), providerSettings),
    captcha: z.record(z.string(), providerSettings),
    /** O13: keyed by channel ('zalo', 'sms'); the entry carries the provider's own settings. */
    notification: z.record(z.string(), providerSettings),
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
      autoRejectCron: '30 * * * * *',
      reconciliationCron: '0 0 * * * *',
      paymentExpiryCron: '*/30 * * * * *',
      manualConfirmCron: '0 15 * * * *',
      walletStatusCron: '0 */2 * * * *',
      opsCheckCron: '0 * * * * *',
      retentionCron: '0 30 3 * * *',
      auditChainCron: '0 */5 * * * *',
      webhookDispatcherCron: '*/15 * * * * *',
      cartExpiryCron: '0 */10 * * * *',
      cartReminderCron: '0 */15 * * * *',
      dataRequestWaitingCron: '0 */30 * * * *',
      customerGroupRefreshCron: '0 15 3 * * *',
      tableSessionAutocloseCron: '0 */15 * * * *',
      heartbeatMinutes: {
        outbox: 2,
        'hold-expiry': 2,
        'payment-expiry': 2,
        'sla-check': 3,
        'auto-reject': 3,
        'idempotency-cleanup': 45,
        'sepay-reconciliation': 150,
        'manual-payment-check': 150,
        'wallet-status-check': 8,
        retention: 1500,
        'audit-chain': 15,
        'webhook-dispatcher': 2,
        'cart-expiry': 15,
        'cart-reminder': 20,
        'data-request-waiting': 35,
        'customer-group-refresh': 1500,
        'table-session-autoclose': 20,
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
      otpDays: 7,
      sessionDays: 30,
      cartDays: 30,
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
    notifications: {
      email: { enabled: false },
      orderLinkTemplate: '',
      dailyLimit: 2000,
      costEstimates: { sms: 900, zalo: 300 },
    },
    tables: { menuUrlTemplate: '' },
    storefront: {
      captchaProvider: '',
      rateLimits: {
        read: { max: 120, windowMs: 60_000 },
        quote: { max: 60, windowMs: 60_000 },
        create: { max: 10, windowMs: 600_000 },
        lookup: { max: 20, windowMs: 900_000 },
        lookupPerCode: { max: 5, windowMs: 900_000 },
        auth: { max: 10, windowMs: 3_600_000 },
        cart: { max: 120, windowMs: 60_000 },
        promotionCode: { max: 20, windowMs: 600_000 },
        rating: { max: 30, windowMs: 600_000 },
      },
    },
    customers: {
      enabled: true,
      otpChannels: ['email'],
      otp: {
        codeMinutes: 5,
        maxAttempts: 5,
        sendMax: 3,
        sendWindowMinutes: 10,
        ipMaxPerHour: 10,
      },
      sessionDays: 30,
      maxSessions: 10,
      inactiveErasureMonths: 0,
    },
    carts: {
      enabled: true,
      expiryDays: 7,
      expiredDeleteDays: 30,
      reminderIdleHours: 2,
      maxLines: 50,
    },
    dataRights: { deadlineHours: 72 },
    testing: { builtins: false },
    publicApiUrl: '',
    walletReturnOrigins: [],
    productTypes: {},
    providers: {
      payment: {},
      fulfillment: {},
      scheduling: {},
      voucher: {},
      captcha: {},
      notification: {},
    },
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
    // O13 providers are disabled by default; enabled ones must pass their strict schema.
    const momo = parseMomoSettings(result.data.providers.payment.momo);
    const vnpay = parseVnpaySettings(result.data.providers.payment.vnpay);
    parseAhamoveSettings(result.data.providers.fulfillment.ahamove);
    parseZaloSettings(result.data.providers.notification.zalo);
    parseEsmsSettings(result.data.providers.notification.sms);
    // Wallet IPN/return URLs need the public base of this server — boot fails without it.
    if ((momo || vnpay) && result.data.publicApiUrl.trim() === '') {
      throw new Error(
        'publicApiUrl is required when a wallet provider (momo/vnpay) is enabled: set ORDERING_PUBLIC_API_URL',
      );
    }
  },
};
