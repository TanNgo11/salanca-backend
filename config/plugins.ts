import fs from 'node:fs';
import path from 'node:path';

import type { Core } from '@strapi/strapi';

import { SEPAY_TEST_SETTINGS } from '../src/plugins/ordering/server/src/providers/sepay/testing';

import { resolveRestApiPrefix } from './api-prefix.helper';
import {
  assertProductionMediaStorage,
  isObjectStorageEnabled,
  resolveMediaStorageConfig,
} from './media-storage.helper';
import {
  isTransactionalEmailConfigured,
  resolveTransactionalEmailConfig,
} from './transactional-email.helper';

const allowedMediaTypes = [
  'image/*',
  'video/*',
  'audio/*',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.*',
  'text/plain',
  'text/csv',
];

const deniedExecutableTypes = [
  'application/vnd.microsoft.portable-executable',
  'application/x-msdownload',
  'application/x-msdos-program',
  'application/x-executable',
  'application/x-dosexec',
  'application/x-sh',
  'text/x-shellscript',
  'application/x-mach-binary',
];

/**
 * Responsive derivative widths (Strapi generates `formats[name]` only when the
 * original is larger than the breakpoint on either edge). Names deliberately
 * differ from Strapi's defaults (small/medium/large): derivative keys are
 * `${name}_${hash}${ext}`, so reusing a default name would overwrite an
 * existing, immutably cached object with different-size content.
 */
export const uploadBreakpoints = {
  w640: 640,
  w960: 960,
  w1280: 1280,
  w1920: 1920,
} as const;

enum AuthCookieSameSite {
  Lax = 'lax',
  None = 'none',
  Strict = 'strict',
}

const resolveAuthCookieSameSite = (value: string): AuthCookieSameSite => {
  switch (value) {
    case AuthCookieSameSite.Lax:
      return AuthCookieSameSite.Lax;
    case AuthCookieSameSite.None:
      return AuthCookieSameSite.None;
    case AuthCookieSameSite.Strict:
      return AuthCookieSameSite.Strict;
    default:
      throw new Error(
        `AUTH_COOKIE_SAME_SITE must be one of: ${Object.values(AuthCookieSameSite).join(', ')}`,
      );
  }
};

export const resolveAuthCookieConfig = (env: Core.Config.Shared.ConfigParams['env']) => {
  const sameSite = resolveAuthCookieSameSite(env('AUTH_COOKIE_SAME_SITE', 'lax'));
  const secure = env.bool('AUTH_COOKIE_SECURE', env('NODE_ENV') === 'production');
  const apiPrefix = resolveRestApiPrefix(env);

  if (sameSite === AuthCookieSameSite.None && !secure) {
    throw new Error('AUTH_COOKIE_SECURE must be true when AUTH_COOKIE_SAME_SITE is none.');
  }

  return {
    name: env('AUTH_COOKIE_NAME', 'salanca_refresh'),
    sameSite,
    path: `${apiPrefix}/auth`,
    secure,
    domain: env('AUTH_COOKIE_DOMAIN'),
  };
};

/** Local generic ordering plugin (docs/plans/ordering-roadmap.md). Off unless ORDERING_ENABLED=true. */
export const orderingPluginPath = './src/plugins/ordering';
const orderingServerEntry = 'dist/server/src/index.js';

export const resolveOrderingPluginConfig = (
  env: Core.Config.Shared.ConfigParams['env'],
  serverEntryExists: (relativePath: string) => boolean = (relativePath) =>
    fs.existsSync(path.resolve(process.cwd(), relativePath)),
) => {
  const sepayFromEnv = (): Record<string, unknown> | null => {
    const webhookSecret = env('SEPAY_WEBHOOK_SECRET', '');
    if (!webhookSecret) return null;
    const accountsRaw = env('SEPAY_ACCOUNTS', '');
    let accounts: unknown = {};
    if (accountsRaw) {
      try {
        accounts = JSON.parse(accountsRaw);
      } catch {
        throw new Error('SEPAY_ACCOUNTS must be a JSON object keyed by account id');
      }
    }
    return {
      enabled: true,
      webhookSecret,
      apiToken: env('SEPAY_API_TOKEN', ''),
      memoTemplate: env('SEPAY_MEMO_TEMPLATE', 'SLC{orderCode}'),
      captureMode: env('SEPAY_CAPTURE_MODE', 'auto'),
      amountTolerance: Number(env('SEPAY_AMOUNT_TOLERANCE', '0')),
      accounts,
    };
  };

  // O13 providers — all opt-in via env, all off by default (docs/providers/*.md).
  const momoFromEnv = (): Record<string, unknown> | null => {
    if (!env('MOMO_PARTNER_CODE', '')) return null;
    return {
      enabled: true,
      partnerCode: env('MOMO_PARTNER_CODE', ''),
      accessKey: env('MOMO_ACCESS_KEY', ''),
      secretKey: env('MOMO_SECRET_KEY', ''),
      environment: env('MOMO_ENVIRONMENT', 'sandbox'),
      requestType: env('MOMO_REQUEST_TYPE', 'captureWallet'),
      ...(env('MOMO_BASE_URL', '') ? { baseUrl: env('MOMO_BASE_URL') } : {}),
    };
  };

  const vnpayFromEnv = (): Record<string, unknown> | null => {
    if (!env('VNPAY_TMN_CODE', '')) return null;
    return {
      enabled: true,
      tmnCode: env('VNPAY_TMN_CODE', ''),
      hashSecret: env('VNPAY_HASH_SECRET', ''),
      environment: env('VNPAY_ENVIRONMENT', 'sandbox'),
      locale: env('VNPAY_LOCALE', 'vn'),
      orderType: env('VNPAY_ORDER_TYPE', 'other'),
      createBy: env('VNPAY_CREATE_BY', 'ordering'),
      ...(env('VNPAY_BASE_URL', '') ? { baseUrl: env('VNPAY_BASE_URL') } : {}),
    };
  };

  const ahamoveFromEnv = (): Record<string, unknown> | null => {
    if (!env('AHAMOVE_API_KEY', '')) return null;
    const requestsRaw = env('AHAMOVE_REQUESTS', '');
    let requests: unknown = [];
    if (requestsRaw) {
      try {
        requests = JSON.parse(requestsRaw);
      } catch {
        throw new Error('AHAMOVE_REQUESTS must be a JSON array of request objects');
      }
    }
    return {
      enabled: true,
      apiKey: env('AHAMOVE_API_KEY', ''),
      webhookToken: env('AHAMOVE_WEBHOOK_TOKEN', ''),
      environment: env('AHAMOVE_ENVIRONMENT', 'staging'),
      serviceId: env('AHAMOVE_SERVICE_ID', 'SGN-BIKE'),
      paymentMethod: env('AHAMOVE_PAYMENT_METHOD', 'CASH'),
      feeSource: env('AHAMOVE_FEE_SOURCE', 'zone'),
      requests,
      ...(env('AHAMOVE_MOBILE', '') ? { mobile: env('AHAMOVE_MOBILE') } : {}),
      ...(env('AHAMOVE_TOKEN', '') ? { token: env('AHAMOVE_TOKEN') } : {}),
      ...(env('AHAMOVE_NAME', '') ? { name: env('AHAMOVE_NAME') } : {}),
      ...(env('AHAMOVE_BASE_URL', '') ? { baseUrl: env('AHAMOVE_BASE_URL') } : {}),
    };
  };

  const zaloFromEnv = (): Record<string, unknown> | null => {
    if (!env('ZALO_ACCESS_TOKEN', '') && !env('ZALO_APP_ID', '')) return null;
    return {
      enabled: true,
      baseUrl: env('ZALO_BASE_URL', 'https://business.openapi.zalo.me'),
      oauthUrl: env('ZALO_OAUTH_URL', 'https://oauth.zaloapp.com/v4/oa/access_token'),
      ...(env('ZALO_ACCESS_TOKEN', '') ? { accessToken: env('ZALO_ACCESS_TOKEN') } : {}),
      ...(env('ZALO_APP_ID', '') ? { appId: env('ZALO_APP_ID') } : {}),
      ...(env('ZALO_APP_SECRET', '') ? { appSecret: env('ZALO_APP_SECRET') } : {}),
      ...(env('ZALO_REFRESH_TOKEN', '') ? { refreshToken: env('ZALO_REFRESH_TOKEN') } : {}),
    };
  };

  const esmsFromEnv = (): Record<string, unknown> | null => {
    if (!env('ESMS_API_KEY', '')) return null;
    return {
      enabled: true,
      apiKey: env('ESMS_API_KEY', ''),
      secretKey: env('ESMS_SECRET_KEY', ''),
      smsType: env('ESMS_SMS_TYPE', '2'),
      isUnicode: env.bool('ESMS_IS_UNICODE', true),
      sandbox: env.bool('ESMS_SANDBOX', false),
      baseUrl: env('ESMS_BASE_URL', 'https://rest.esms.vn'),
      ...(env('ESMS_BRANDNAME', '') ? { brandname: env('ESMS_BRANDNAME') } : {}),
      ...(env('ESMS_CAMPAIGN', '') ? { campaign: env('ESMS_CAMPAIGN') } : {}),
    };
  };

  const enabled = env.bool('ORDERING_ENABLED', false);
  // Strapi silently skips a plugin whose server entry is missing; fail loudly instead.
  if (enabled && !serverEntryExists(path.join(orderingPluginPath, orderingServerEntry))) {
    throw new Error(
      `ORDERING_ENABLED=true but ${orderingPluginPath}/${orderingServerEntry} is missing; run pnpm run build:ordering.`,
    );
  }
  const builtins = env.bool('ORDERING_TEST_BUILTINS', false);
  const turnstileSecret = env('TURNSTILE_SECRET_KEY', '');
  // Builtins always use the fixture so a developer's real SePay secret never reaches tests.
  const sepay = builtins ? SEPAY_TEST_SETTINGS : sepayFromEnv();
  const momo = momoFromEnv();
  const vnpay = vnpayFromEnv();
  const ahamove = ahamoveFromEnv();
  const zalo = zaloFromEnv();
  const esms = esmsFromEnv();
  const paymentProviders = {
    ...(sepay ? { sepay } : {}),
    ...(momo ? { momo } : {}),
    ...(vnpay ? { vnpay } : {}),
  };
  // Keyed by channel (zalo, sms) — eSMS is the SMS provider implementation.
  const notificationProviders = {
    ...(zalo ? { zalo } : {}),
    ...(esms ? { sms: esms } : {}),
  };
  const providers = {
    ...(Object.keys(paymentProviders).length > 0 ? { payment: paymentProviders } : {}),
    ...(ahamove ? { fulfillment: { ahamove } } : {}),
    ...(Object.keys(notificationProviders).length > 0
      ? { notification: notificationProviders }
      : {}),
    ...(turnstileSecret
      ? { captcha: { turnstile: { enabled: true, secretKey: turnstileSecret } } }
      : {}),
  };
  const dailyLimit = env('ORDERING_NOTIFY_DAILY_LIMIT', '');
  const costEstimatesRaw = env('ORDERING_NOTIFY_COST_ESTIMATES', '');
  let costEstimates: unknown = null;
  if (costEstimatesRaw) {
    try {
      costEstimates = JSON.parse(costEstimatesRaw);
    } catch {
      throw new Error('ORDERING_NOTIFY_COST_ESTIMATES must be a JSON object keyed by channel');
    }
  }
  // O13: OTP channels beyond email are opt-in (`email,sms,zalo`); sms/zalo also need the
  // matching provider config or sends are skipped at delivery time.
  const otpChannels = env('ORDERING_OTP_CHANNELS', '')
    .split(',')
    .map((channel) => channel.trim())
    .filter(Boolean);
  return {
    enabled,
    resolve: orderingPluginPath,
    config: {
      orderCode: { prefix: 'SLC' },
      // O13: absolute public base for wallet IPN/return URLs (required when momo/vnpay is on).
      publicApiUrl: env('ORDERING_PUBLIC_API_URL', ''),
      // Wallet return URLs may only point back to the storefront (same list as CORS).
      walletReturnOrigins: env('FRONTEND_URLS', 'http://localhost:3000')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean),
      // Same trusted-forwarding headers and secret the web already sends for form intake.
      clientIp: {
        sharedSecret: env('FORM_INTAKE_SHARED_SECRET', ''),
        secretHeader: 'x-salanca-intake-secret',
        ipHeader: 'x-salanca-visitor-ip',
      },
      encryptionKey: env('ORDERING_ENCRYPTION_KEY', ''),
      // Order emails use the same SMTP as form notifications; the link carries the token after '#'.
      notifications: {
        ...(builtins
          ? {
              email: { enabled: true },
              orderLinkTemplate: 'http://localhost:3000/don-hang#t={token}',
            }
          : {
              email: { enabled: isTransactionalEmailConfigured(env) },
              orderLinkTemplate: env(
                'ORDERING_ORDER_LINK_TEMPLATE',
                `${(env('FRONTEND_URLS', 'http://localhost:3000').split(',')[0] ?? '').trim()}/don-hang#t={token}`,
              ),
            }),
        ...(dailyLimit ? { dailyLimit: Number(dailyLimit) } : {}),
        ...(costEstimates ? { costEstimates } : {}),
      },
      // O12: the table QR lands on the storefront's at-table menu route.
      tables: builtins
        ? { menuUrlTemplate: 'http://localhost:3000/ban?t={token}' }
        : {
            menuUrlTemplate: env(
              'ORDERING_TABLE_MENU_TEMPLATE',
              `${(env('FRONTEND_URLS', 'http://localhost:3000').split(',')[0] ?? '').trim()}/ban?t={token}`,
            ),
          },
      // Turnstile guards order creation and lookup when the app has a secret (same key as forms).
      // Builtins replace it with the in-memory captcha. SePay and captcha share `providers`.
      ...(Object.keys(providers).length > 0 ? { providers } : {}),
      ...(turnstileSecret && !builtins ? { storefront: { captchaProvider: 'turnstile' } } : {}),
      ...(otpChannels.length > 0 ? { customers: { otpChannels } } : {}),
      ...(builtins
        ? {
            testing: { builtins: true },
            catalog: { adapter: 'test-catalog' },
            jobs: { enabled: false },
            storefront: { captchaProvider: 'test-captcha' },
          }
        : {}),
    },
  };
};

/** Local generic SEO audit plugin (docs/phases/phase-seo-toolkit-1-cms-audit.md). Off unless SEO_TOOLKIT_ENABLED=true. */
export const seoToolkitPluginPath = './src/plugins/seo-toolkit';
const seoToolkitServerEntry = 'dist/server/src/index.js';

export const resolveSeoToolkitPluginConfig = (
  env: Core.Config.Shared.ConfigParams['env'],
  serverEntryExists: (relativePath: string) => boolean = (relativePath) =>
    fs.existsSync(path.resolve(process.cwd(), relativePath)),
) => {
  const enabled = env.bool('SEO_TOOLKIT_ENABLED', false);
  // Strapi silently skips a plugin whose server entry is missing; fail loudly instead.
  if (enabled && !serverEntryExists(path.join(seoToolkitPluginPath, seoToolkitServerEntry))) {
    throw new Error(
      `SEO_TOOLKIT_ENABLED=true but ${seoToolkitPluginPath}/${seoToolkitServerEntry} is missing; run pnpm run build:seo-toolkit.`,
    );
  }
  return {
    enabled,
    resolve: seoToolkitPluginPath,
    config: {
      // Salanca content types that carry `shared.seo` (spec §6). UIDs live here, never in the
      // plugin. `slug` is a string attribute on the collections. `global-setting.defaultSeo` is a
      // fallback (shared with the home page by design), so it is excluded: it would only report
      // duplicates that are not real problems.
      contentTypes: {
        'api::home-page.home-page': {},
        'api::menu-page.menu-page': { seoField: ['seo', 'cateringSeo'] },
        'api::story-page.story-page': {},
        'api::space-page.space-page': {},
        'api::experience-page.experience-page': {},
        'api::campaign-page.campaign-page': {},
        'api::booking-page.booking-page': {},
        'api::contact-page.contact-page': {},
        'api::campaign.campaign': { labelField: 'slug' },
        'api::menu-category.menu-category': { labelField: 'slug' },
        'api::menu-package.menu-package': { labelField: 'slug' },
        'api::location.location': { labelField: 'slug' },
      },
    },
  };
};

const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Plugin => {
  assertProductionMediaStorage(env);

  const uploadCommon = {
    breakpoints: { ...uploadBreakpoints },
    security: {
      allowedTypes: allowedMediaTypes,
      deniedTypes: deniedExecutableTypes,
    },
  };

  const uploadConfig = isObjectStorageEnabled(env)
    ? {
        ...resolveMediaStorageConfig(env),
        ...uploadCommon,
      }
    : uploadCommon;

  return {
    'users-permissions': {
      config: {
        jwtManagement: 'refresh',
        sessions: {
          httpOnly: true,
          cookie: resolveAuthCookieConfig(env),
        },
      },
    },
    // Opt-in Resend SMTP (BDS pattern). Set EMAIL_SMTP_HOST to enable; leave unset for form-only local.
    ...(isTransactionalEmailConfigured(env)
      ? {
          email: {
            config: resolveTransactionalEmailConfig(env),
          },
        }
      : {}),
    upload: {
      config: uploadConfig,
    },
    ordering: resolveOrderingPluginConfig(env),
    'seo-toolkit': resolveSeoToolkitPluginConfig(env),
  };
};

export default config;
