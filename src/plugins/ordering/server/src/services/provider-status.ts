import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { parseAhamoveSettings } from '../providers/ahamove/config';
import { parseEsmsSettings } from '../providers/esms/config';
import { parseMomoSettings } from '../providers/momo/config';
import { parseSepaySettings } from '../providers/sepay/config';
import { parseVnpaySettings } from '../providers/vnpay/config';
import { parseZaloSettings } from '../providers/zalo-zns/config';
import type alertRulesFactory from './alert-rules';
import type { OrderingRegistry } from './registry';

const HOUR_MS = 3_600_000;

export type ProviderCardState = 'configured' | 'unconfigured' | 'error' | 'not-implemented';
export type ProviderGroup = 'payment' | 'fulfillment' | 'notification';

export type WebhookHealth = {
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  state: 'ok' | 'slow' | 'failing';
};

export type ProviderCard = {
  code: string;
  group: ProviderGroup;
  state: ProviderCardState;
  environment: 'sandbox' | 'production' | null;
  /** Masked identifier — last 4 chars only (e.g. `••••7KQ2`); never a secret. */
  partnerRef: string | null;
  /** Env var names the operator still has to set (only when state !== 'configured'). */
  envNeeded: string[];
  /** Provider-facing webhook/IPN path under the public API (null when none). */
  webhookPath: string | null;
  /** Absolute URL when ORDERING_PUBLIC_API_URL is set. */
  webhookUrl: string | null;
  docsPath: string | null;
  webhookHealth: WebhookHealth | null;
};

export type ProviderOverview = {
  now: string;
  publicApiUrl: string;
  groups: Array<{ key: ProviderGroup; cards: ProviderCard[] }>;
};

const mask = (value: string | undefined | null): string | null =>
  value ? `••••${value.slice(-4)}` : null;

const WEBHOOK_PROVIDERS = new Set(['sepay', 'momo', 'vnpay', 'ahamove']);

/**
 * "Nhà cung cấp" (screens P1, contracts §19.3): grouped read-only cards for every integration
 * slot. Only derived metadata leaves this service — partner ids are masked to their last four
 * characters and no secret, token or key field is ever returned. `state` is 'error' when an
 * enabled provider's env config fails its strict schema (the plugin would refuse to boot —
 * the card is how an operator sees that while it is still up).
 */
const providerStatus = ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin('ordering');
  const registry = () => plugin().service('registry') as OrderingRegistry;
  const alertRules = () => plugin().service('alert-rules') as ReturnType<typeof alertRulesFactory>;
  const store = () => strapi.store({ type: 'plugin', name: 'ordering' });
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;

  const health = async (code: string): Promise<WebhookHealth> => {
    const now = Date.now();
    const [lastSuccess, lastFailure, failures, rule] = await Promise.all([
      store().get({ key: `webhook-last-success:${code}` }),
      store().get({ key: `webhook-last-failure:${code}` }),
      store().get({ key: `webhook-failures:${code}` }),
      alertRules().ruleOf('webhook-failing'),
    ]);
    const consecutiveFailures = Number(failures) || 0;
    const lastSuccessAt = typeof lastSuccess === 'string' ? lastSuccess : null;
    const stale =
      lastSuccessAt !== null && now - new Date(lastSuccessAt).getTime() > 24 * HOUR_MS;
    return {
      lastSuccessAt,
      lastFailureAt: typeof lastFailure === 'string' ? lastFailure : null,
      consecutiveFailures,
      state: consecutiveFailures >= rule.threshold ? 'failing' : stale ? 'slow' : 'ok',
    };
  };

  const overview = async (): Promise<ProviderOverview> => {
    const cfg = config();
    const publicApiUrl = cfg.publicApiUrl.trim();
    const webhookUrl = (code: string): { path: string; url: string | null } => {
      const path = `/api/v1/ordering/webhooks/${code}`;
      return { path, url: publicApiUrl ? `${publicApiUrl}${path}` : null };
    };

    type PartialCard = Omit<ProviderCard, 'webhookPath' | 'webhookUrl' | 'webhookHealth'>;
    const finish = async (card: PartialCard): Promise<ProviderCard> => {
      const hook = WEBHOOK_PROVIDERS.has(card.code) ? webhookUrl(card.code) : null;
      return {
        ...card,
        webhookPath: hook?.path ?? null,
        webhookUrl: hook?.url ?? null,
        webhookHealth: hook ? await health(card.code) : null,
      };
    };

    /** Parse an env-backed settings block; 'error' when it is enabled but malformed. */
    const parse = <T>(
      fn: (raw: unknown) => T | null,
      raw: unknown,
    ): { settings: T | null; error: boolean } => {
      try {
        return { settings: fn(raw), error: false };
      } catch {
        return { settings: null, error: true };
      }
    };

    const payment = config().providers.payment;
    const fulfillment = config().providers.fulfillment;
    const notification = config().providers.notification;
    const reg = registry();
    const cards: ProviderCard[] = [];

    // ── Payment ──────────────────────────────────────────────────────────────
    cards.push(
      await finish({
        code: 'cash',
        group: 'payment',
        state: reg.hasPaymentProvider('cash') ? 'configured' : 'unconfigured',
        environment: null,
        partnerRef: null,
        envNeeded: [],
        docsPath: null,
      }),
    );

    const sepay = parse(parseSepaySettings, payment.sepay);
    cards.push(
      await finish({
        code: 'sepay',
        group: 'payment',
        state: sepay.error ? 'error' : sepay.settings ? 'configured' : 'unconfigured',
        environment: null,
        partnerRef: sepay.settings
          ? mask(Object.keys(sepay.settings.accounts)[0] ?? null)
          : null,
        envNeeded: ['SEPAY_API_TOKEN', 'SEPAY_ACCOUNTS', 'SEPAY_WEBHOOK_SECRET'],
        docsPath: 'docs/providers/sepay.md',
      }),
    );

    const momo = parse(parseMomoSettings, payment.momo);
    cards.push(
      await finish({
        code: 'momo',
        group: 'payment',
        state: momo.error ? 'error' : momo.settings ? 'configured' : 'unconfigured',
        environment: momo.settings?.environment ?? null,
        partnerRef: mask(momo.settings?.partnerCode),
        envNeeded: ['MOMO_PARTNER_CODE', 'MOMO_ACCESS_KEY', 'MOMO_SECRET_KEY'],
        docsPath: 'docs/providers/momo.md',
      }),
    );

    const vnpay = parse(parseVnpaySettings, payment.vnpay);
    cards.push(
      await finish({
        code: 'vnpay',
        group: 'payment',
        state: vnpay.error ? 'error' : vnpay.settings ? 'configured' : 'unconfigured',
        environment: vnpay.settings?.environment ?? null,
        partnerRef: mask(vnpay.settings?.tmnCode),
        envNeeded: ['VNPAY_TMN_CODE', 'VNPAY_HASH_SECRET'],
        docsPath: 'docs/providers/vnpay.md',
      }),
    );

    // Gift cards come from an in-process voucher provider, not env settings (roadmap O16+).
    cards.push(
      await finish({
        code: 'gift-card',
        group: 'payment',
        state: reg.hasVoucherProvider('gift-card') ? 'configured' : 'not-implemented',
        environment: null,
        partnerRef: null,
        envNeeded: [],
        docsPath: 'docs/ordering-writing-providers.md',
      }),
    );

    // ── Fulfillment ──────────────────────────────────────────────────────────
    cards.push(
      await finish({
        code: 'self-delivery',
        group: 'fulfillment',
        state: reg.hasFulfillmentProvider('self-delivery') ? 'configured' : 'unconfigured',
        environment: null,
        partnerRef: null,
        envNeeded: [],
        docsPath: null,
      }),
    );

    const ahamove = parse(parseAhamoveSettings, fulfillment.ahamove);
    cards.push(
      await finish({
        code: 'ahamove',
        group: 'fulfillment',
        state: ahamove.error ? 'error' : ahamove.settings ? 'configured' : 'unconfigured',
        environment: ahamove.settings?.environment === 'production' ? 'production' : ahamove.settings ? 'sandbox' : null,
        // Never a hint of the API key — only the (masked) account mobile, when there is one.
        partnerRef: mask(ahamove.settings?.mobile),
        envNeeded: ['AHAMOVE_API_KEY', 'AHAMOVE_MOBILE', 'AHAMOVE_WEBHOOK_TOKEN'],
        docsPath: 'docs/providers/ahamove.md',
      }),
    );

    // GHN is the reserved third-party slot (same contract shape as Ahamove).
    cards.push(
      await finish({
        code: 'ghn',
        group: 'fulfillment',
        state: reg.hasFulfillmentProvider('ghn') ? 'configured' : 'not-implemented',
        environment: null,
        partnerRef: null,
        envNeeded: [],
        docsPath: 'docs/ordering-writing-providers.md',
      }),
    );

    // ── Notification ─────────────────────────────────────────────────────────
    cards.push(
      await finish({
        code: 'email',
        group: 'notification',
        state: reg.hasNotificationProvider('email') ? 'configured' : 'unconfigured',
        environment: null,
        partnerRef: null,
        envNeeded: config().notifications.email.enabled ? [] : ['EMAIL_SMTP_HOST'],
        docsPath: 'docs/ordering-integrations.md',
      }),
    );

    const zalo = parse(parseZaloSettings, notification.zalo);
    cards.push(
      await finish({
        code: 'zalo',
        group: 'notification',
        state: zalo.error ? 'error' : zalo.settings ? 'configured' : 'unconfigured',
        environment: null,
        partnerRef: mask(zalo.settings?.appId),
        envNeeded: ['ZALO_ACCESS_TOKEN', 'ZALO_APP_ID', 'ZALO_APP_SECRET', 'ZALO_REFRESH_TOKEN'],
        docsPath: 'docs/providers/zalo-zns.md',
      }),
    );

    const esms = parse(parseEsmsSettings, notification.sms);
    cards.push(
      await finish({
        code: 'sms',
        group: 'notification',
        state: esms.error ? 'error' : esms.settings ? 'configured' : 'unconfigured',
        environment: null,
        partnerRef: esms.settings?.brandname ?? null,
        envNeeded: ['ESMS_API_KEY', 'ESMS_SECRET_KEY', 'ESMS_BRANDNAME'],
        docsPath: 'docs/providers/sms-esms.md',
      }),
    );

    const groups: ProviderOverview['groups'] = (
      ['payment', 'fulfillment', 'notification'] as ProviderGroup[]
    ).map((key) => ({ key, cards: cards.filter((card) => card.group === key) }));

    return { now: new Date().toISOString(), publicApiUrl, groups };
  };

  return { overview };
};

export default providerStatus;
