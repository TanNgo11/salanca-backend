import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import {
  LIMITS,
  parseCartRequest,
  parseIdempotencyKey,
  parseOrderRequest,
} from '../domain/storefront/parse';
import type branchFactory from '../services/branch';
import type { ServiceContext } from '../services/context';
import type { OrderingRegistry } from '../services/registry';
import type storefrontFactory from '../services/storefront';
import type { HttpCtx } from './http';
import { sendError, text } from './http';
import { sessionFor } from './customer-auth';
import { clientIpOf, rateLimited } from './storefront-guard';

type BranchService = ReturnType<typeof branchFactory>;
type StorefrontService = ReturnType<typeof storefrontFactory>;

/** Query names a token must never travel in (contracts §11: header only, never path/query). */
const TOKEN_QUERY_KEYS = ['token', 't', 'orderToken', 'order_token', 'publicToken'];

/**
 * Public storefront API (contracts §11, §21; `auth: false`). Every action rate-limits by trusted
 * client IP, caps the body size, reads only allowlisted fields and answers with allowlisted views.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const branches = () => strapi.plugin('ordering').service('branch') as BranchService;
  const storefront = () => strapi.plugin('ordering').service('storefront') as StorefrontService;
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;

  const customerCtx = (): ServiceContext => ({
    actor: { kind: 'customer' },
    requestId: randomUUID(),
  });

  /** Wraps a public action: body cap, token-in-query refusal, error mapping, no caching. */
  const action =
    (bucket: Parameters<typeof rateLimited>[2], run: (ctx: HttpCtx, serviceCtx: ServiceContext) => Promise<unknown>) =>
    async (ctx: HttpCtx) => {
      const serviceCtx = customerCtx();
      if (rateLimited(strapi, ctx, bucket)) return;
      try {
        ctx.set('Cache-Control', 'no-store');
        const length = Number(ctx.get('content-length') || 0);
        if (length > LIMITS.bodyBytes) {
          ctx.status = 413;
          ctx.body = { error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large.' } };
          return;
        }
        if (TOKEN_QUERY_KEYS.some((key) => ctx.query[key] !== undefined)) {
          throw new OrderingError(
            'ORDER_TOKEN_INVALID',
            'send the order token in the X-Order-Token header, never in the URL',
          );
        }
        const result = await run(ctx, serviceCtx);
        if (result !== undefined) ctx.body = result;
      } catch (error) {
        sendError(ctx, error, serviceCtx.requestId);
      }
    };

  const verifyCaptcha = async (ctx: HttpCtx, token: string | undefined, captchaAction: string) => {
    const code = config().storefront.captchaProvider;
    if (!code) return;
    const provider = (strapi.plugin('ordering').service('registry') as OrderingRegistry).captchaProvider(code);
    const result = await provider.verify({
      token: token ?? '',
      ip: clientIpOf(strapi, ctx),
      action: captchaAction,
    });
    if (!result.valid) {
      throw new OrderingError('CAPTCHA_FAILED', 'captcha verification failed', {
        details: { reason: result.code },
      });
    }
  };

  const orderToken = (ctx: HttpCtx) => ctx.get('x-order-token') || undefined;

  return {
    /** GET /branches — active branches that sell online. */
    async branches(ctx: HttpCtx) {
      if (rateLimited(strapi, ctx, 'read')) return;
      try {
        ctx.set('Cache-Control', 'public, max-age=30');
        ctx.body = { items: await branches().listPublic() };
      } catch (error) {
        sendError(ctx, error);
      }
    },

    /** GET /config?branch= */
    config: action('read', async (ctx, serviceCtx) =>
      storefront().config(text(ctx.query.branch), serviceCtx),
    ),

    /** GET /slots?branch=&date= */
    slots: action('read', async (ctx, serviceCtx) =>
      storefront().slots(text(ctx.query.branch) ?? '', text(ctx.query.date) ?? '', serviceCtx),
    ),

    /** POST /quote */
    quote: action('quote', async (ctx, serviceCtx) => {
      const cart = parseCartRequest(ctx.request.body);
      return storefront()
        .orders()
        .quote(
          {
            ...cart,
            contact: { phone: '' },
            consent: { policyVersion: config().consent.policyVersion, channel: 'web-checkout' },
            origin: { kind: 'storefront' },
          },
          serviceCtx,
        );
    }),

    /** POST /orders — Idempotency-Key header + captcha; returns the token once (and on replay). */
    create: action('create', async (ctx, serviceCtx) => {
      const idempotencyKey = parseIdempotencyKey(ctx.get('idempotency-key'));
      const request = parseOrderRequest(ctx.request.body);
      await verifyCaptcha(ctx, request.captchaToken, 'order-create');
      // Optional sign-in: a live X-Customer-Token links the order to that profile (session
      // wins over the contact phone — plan step 3 "phiên hoặc theo SĐT").
      const session = await sessionFor(strapi, ctx, serviceCtx);
      const { captchaToken: _captcha, ...input } = request;
      const result = await storefront()
        .orders()
        .createOrder(
          {
            ...input,
            idempotencyKey,
            ...(session ? { customerId: session.customer.id } : {}),
            consent: { ...input.consent, channel: 'web-checkout' },
            origin: { kind: 'storefront' },
          },
          serviceCtx,
        );
      const view = await storefront().viewByToken(result.publicToken, serviceCtx);
      ctx.status = result.replayed ? 200 : 201;
      return { order: view, token: result.publicToken, replayed: result.replayed };
    }),

    /** GET /orders — X-Order-Token. */
    show: action('read', async (ctx, serviceCtx) => ({
      order: await storefront().viewByToken(orderToken(ctx), serviceCtx),
    })),

    /** GET /orders/payment — X-Order-Token. */
    payment: action('read', async (ctx) => ({
      payment: await storefront().paymentByToken(orderToken(ctx)),
    })),

    /** POST /orders/lookup — { code, phone, captchaToken }; status-only, no PII, no actions. */
    lookup: action('lookup', async (ctx) => {
      const input = (ctx.request.body ?? {}) as Record<string, unknown>;
      const code = typeof input.code === 'string' ? input.code.slice(0, 40) : '';
      const phone = typeof input.phone === 'string' ? input.phone.slice(0, 32) : '';
      // Per-code limit on top of the per-IP bucket: 5 tries / 15 minutes for one order code.
      if (rateLimited(strapi, ctx, 'lookupPerCode', code.trim().toUpperCase() || 'empty')) return undefined;
      await verifyCaptcha(ctx, typeof input.captchaToken === 'string' ? input.captchaToken : undefined, 'order-lookup');
      return { order: await storefront().lookup({ code, phone }) };
    }),

    /** POST /orders/cancel — X-Order-Token; only while customer-cancellable. */
    cancel: action('create', async (ctx, serviceCtx) => {
      const body = (ctx.request.body ?? {}) as { reason?: unknown };
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined;
      return { order: await storefront().cancelByToken(orderToken(ctx), reason, serviceCtx) };
    }),
  };
};
