import type { Core } from '@strapi/strapi';
import { describe, expect, it } from 'vitest';

import config from '../config';
import type { OrderingConfig } from '../config';
import providerStatus from './provider-status';

type ProviderCardState = {
  code: string;
  state: string;
  environment: string | null;
  partnerRef: string | null;
  envNeeded: string[];
  webhookPath: string | null;
  webhookUrl: string | null;
};

const makeStrapi = (
  cfg: OrderingConfig,
  registered: { payment?: string[]; fulfillment?: string[]; notification?: string[]; voucher?: string[] },
  storeData: Record<string, unknown> = {},
) =>
  ({
    plugin: () => ({
      service: (name: string) => {
        if (name === 'alert-rules') return { ruleOf: async () => ({ threshold: 3 }) };
        if (name === 'registry') {
          const has = (list: string[] | undefined) => (code: string) => (list ?? []).includes(code);
          return {
            hasPaymentProvider: has(registered.payment),
            hasFulfillmentProvider: has(registered.fulfillment),
            hasNotificationProvider: has(registered.notification),
            hasVoucherProvider: has(registered.voucher),
          };
        }
        return {};
      },
    }),
    config: { get: () => cfg },
    store: () => ({
      get: async ({ key }: { key: string }) => storeData[key],
      set: async ({ key, value }: { key: string; value: unknown }) => {
        storeData[key] = value;
      },
    }),
  }) as unknown as Core.Strapi;

const overview = async (strapi: Core.Strapi) =>
  (providerStatus({ strapi }) as { overview: () => Promise<{ groups: { key: string; cards: ProviderCardState[] }[] }> }).overview();

const cardOf = (groups: { key: string; cards: ProviderCardState[] }[], code: string) =>
  groups.flatMap((group) => group.cards).find((card) => card.code === code);

describe('ordering provider-status', () => {
  it('lists every group with masked metadata and no secrets', async () => {
    const cfg = structuredClone(config.default);
    const strapi = makeStrapi(cfg, {
      payment: ['cash'],
      fulfillment: ['self-delivery'],
      notification: ['email'],
    });
    const body = await overview(strapi);
    expect(body.groups.map((group) => group.key)).toEqual([
      'payment',
      'fulfillment',
      'notification',
    ]);
    const payment = body.groups[0].cards.map((card) => card.code);
    expect(payment).toEqual(['cash', 'sepay', 'momo', 'vnpay', 'gift-card']);
    expect(cardOf(body.groups, 'cash')?.state).toBe('configured');
    expect(cardOf(body.groups, 'sepay')?.envNeeded).toContain('SEPAY_API_TOKEN');
    expect(cardOf(body.groups, 'ghn')?.state).toBe('not-implemented');
    expect(cardOf(body.groups, 'email')?.state).toBe('configured');
    // No raw secret material anywhere in the payload.
    expect(JSON.stringify(body)).not.toContain('secretKey');
  });

  it('marks an enabled wallet provider configured with masked partner + webhook URL', async () => {
    const cfg = structuredClone(config.default);
    cfg.publicApiUrl = 'https://api.example.com';
    cfg.providers.payment.momo = {
      enabled: true,
      partnerCode: 'MOMOABC12345',
      accessKey: 'ak',
      secretKey: 'sk',
      environment: 'sandbox',
      requestType: 'captureWallet',
    };
    const strapi = makeStrapi(cfg, { payment: ['cash', 'momo'] });
    const body = await overview(strapi);
    const momo = cardOf(body.groups, 'momo');
    expect(momo?.state).toBe('configured');
    expect(momo?.environment).toBe('sandbox');
    expect(momo?.partnerRef).toBe('••••2345');
    expect(momo?.webhookUrl).toBe('https://api.example.com/api/v1/ordering/webhooks/momo');
  });

  it('never shows any part of an API key', async () => {
    const cfg = structuredClone(config.default);
    cfg.providers.fulfillment.ahamove = {
      enabled: true,
      apiKey: 'AHAKEY-SECRET-9876',
      token: 'tok',
      webhookToken: 'w'.repeat(16),
    };
    cfg.providers.notification.sms = { enabled: true, apiKey: 'ESMSKEY-5432', secretKey: 'sk', smsType: '8' };
    const strapi = makeStrapi(cfg, { fulfillment: ['ahamove'], notification: ['sms'] });
    const body = await overview(strapi);
    expect(cardOf(body.groups, 'ahamove')?.state).toBe('configured');
    expect(cardOf(body.groups, 'ahamove')?.partnerRef).toBeNull();
    expect(cardOf(body.groups, 'sms')?.state).toBe('configured');
    expect(cardOf(body.groups, 'sms')?.partnerRef).toBeNull();
    const text = JSON.stringify(body);
    expect(text).not.toContain('9876');
    expect(text).not.toContain('5432');
  });

  it('flags an enabled-but-malformed provider as error', async () => {
    const cfg = structuredClone(config.default);
    cfg.providers.payment.vnpay = { enabled: true };
    const strapi = makeStrapi(cfg, { payment: ['cash'] });
    const body = await overview(strapi);
    expect(cardOf(body.groups, 'vnpay')?.state).toBe('error');
  });

  it('reports webhook health from the alert store keys', async () => {
    const cfg = structuredClone(config.default);
    cfg.providers.payment.momo = {
      enabled: true,
      partnerCode: 'MOMO1',
      accessKey: 'ak',
      secretKey: 'sk',
      environment: 'sandbox',
      requestType: 'captureWallet',
    };
    const strapi = makeStrapi(
      cfg,
      { payment: ['cash', 'momo'] },
      { 'webhook-failures:momo': '5', 'webhook-last-failure:momo': '2026-10-13T00:00:00Z' },
    );
    const body = await overview(strapi);
    const health = (body.groups[0].cards.find((card) => card.code === 'momo') as { webhookHealth?: { state: string; consecutiveFailures: number } }).webhookHealth;
    expect(health?.state).toBe('failing');
    expect(health?.consecutiveFailures).toBe(5);
  });
});
