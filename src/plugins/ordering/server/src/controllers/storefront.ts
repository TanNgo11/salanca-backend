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
import {
  alertGiftCardProbing,
  clientIpOf,
  isWrongPromotionCode,
  notePromotionCodeFailure,
  PROMOTION_CAPTCHA_AFTER,
  promotionCodeFailureCount,
  promotionCodeLimit,
  GIFT_CARD_CAPTCHA_AFTER,
  giftCardFailureCount,
  giftCardLimit,
  noteGiftCardFailure,
  rateLimited,
} from './storefront-guard';
import { currentPolicyVersion } from '../services/ordering-settings';

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

  const maybeAlertProbing = (ip: string, count: number, serviceCtx: ServiceContext) =>
    alertGiftCardProbing(strapi, ip, count, serviceCtx);
  const ratings = () =>
    strapi.plugin('ordering').service('rating') as ReturnType<typeof import('../services/rating').default>;

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
      // No phone on the quote: promotion outcomes that depend on a number's history are decided
      // at create (captcha-gated), so the quote cannot be used to probe whether a number ordered.
      const body = (ctx.request.body ?? {}) as { captchaToken?: unknown };
      const ip = clientIpOf(strapi, ctx);
      const codeLimit = promotionCodeLimit(strapi);
      const tooMany = () => {
        ctx.status = 429;
        ctx.body = {
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
        };
        return undefined;
      };
      if (cart.promotionCode) {
        const failures = promotionCodeFailureCount(ip);
        if (failures >= codeLimit.max) return tooMany();
        if (failures >= PROMOTION_CAPTCHA_AFTER) {
          await verifyCaptcha(
            ctx,
            typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
            'order-create',
          );
        }
      }
      // O9: entering a card code is the same guessing surface — the card bucket counts
      // "code not found" quotes, captcha from CAPTCHA_AFTER, 429 at max.
      const cardLimit = giftCardLimit(strapi);
      if (cart.payment?.giftCardCode) {
        const failures = giftCardFailureCount(ip);
        if (failures >= cardLimit.max) {
          // Still counting while limited — a prober hammering 429s is the escalation signal.
          await maybeAlertProbing(ip, noteGiftCardFailure(ip, cardLimit.windowMs), serviceCtx);
          return tooMany();
        }
        if (failures >= GIFT_CARD_CAPTCHA_AFTER) {
          await verifyCaptcha(
            ctx,
            typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
            'gift-card-use',
          );
        }
      }
      const session = await sessionFor(strapi, ctx, serviceCtx);
      const quoted = await storefront()
        .orders()
        .quote(
          {
            ...cart,
            contact: { phone: '' },
            consent: { policyVersion: await currentPolicyVersion(strapi), channel: 'web-checkout' },
            origin: { kind: 'storefront' },
            ...(session ? { customerId: session.customer.id } : {}),
          },
          serviceCtx,
        );
      const rejected = (quoted as { rejectedPromotions?: Array<{ reason: string }> }).rejectedPromotions ?? [];
      if (cart.promotionCode && rejected.some((row) => isWrongPromotionCode(row.reason))) {
        if (notePromotionCodeFailure(ip, codeLimit.windowMs) >= codeLimit.max) return tooMany();
      }
      const cardResult = (quoted as { giftCard?: { reason?: string } | null }).giftCard;
      if (cart.payment?.giftCardCode && cardResult?.reason === 'invalid') {
        const count = noteGiftCardFailure(ip, cardLimit.windowMs);
        await maybeAlertProbing(ip, count, serviceCtx);
        if (count >= cardLimit.max) return tooMany();
      }
      return quoted;
    }),

    /**
     * POST /gift-cards/balance — `{ code, captchaToken? }`; safe view only
     * (status/balance/last4/expiry — never the code, no holder PII). Wrong codes count
     * toward the card bucket: captcha from GIFT_CARD_CAPTCHA_AFTER, 429 at max.
     */
    giftCardBalance: action('read', async (ctx, serviceCtx) => {
      const body = (ctx.request.body ?? {}) as { code?: unknown; captchaToken?: unknown };
      const code = typeof body.code === 'string' ? body.code.slice(0, 40) : '';
      const ip = clientIpOf(strapi, ctx);
      const cardLimit = giftCardLimit(strapi);
      const tooMany = () => {
        ctx.status = 429;
        ctx.body = {
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
        };
        return undefined;
      };
      const failures = giftCardFailureCount(ip);
      if (failures >= cardLimit.max) {
        // Still counting while limited — a prober hammering 429s is the escalation signal.
        await maybeAlertProbing(ip, noteGiftCardFailure(ip, cardLimit.windowMs), serviceCtx);
        return tooMany();
      }
      if (failures >= GIFT_CARD_CAPTCHA_AFTER) {
        await verifyCaptcha(
          ctx,
          typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
          'gift-card-balance',
        );
      }
      const card = await storefront().giftCardBalance(code, serviceCtx);
      if (!card) {
        const count = noteGiftCardFailure(ip, cardLimit.windowMs);
        await maybeAlertProbing(ip, count, serviceCtx);
        if (count >= cardLimit.max) return tooMany();
        // Same error for unknown, malformed and inactive codes — no existence oracle.
        throw new OrderingError('GIFT_CARD_INVALID', 'gift card cannot be used');
      }
      return { card };
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
      // O9: a guessed card code at create counts against the same IP budget as at quote —
      // the captcha above already makes probing expensive, this closes a second window.
      if (input.payment?.giftCardCode && giftCardFailureCount(clientIpOf(strapi, ctx)) >= giftCardLimit(strapi).max) {
        const ip = clientIpOf(strapi, ctx);
        await maybeAlertProbing(ip, noteGiftCardFailure(ip, giftCardLimit(strapi).windowMs), serviceCtx);
        ctx.status = 429;
        ctx.body = {
          error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
        };
        return undefined;
      }
      let result;
      try {
        result = await storefront()
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
      } catch (error) {
        if (error instanceof OrderingError && error.code === 'GIFT_CARD_INVALID') {
          const ip = clientIpOf(strapi, ctx);
          const count = noteGiftCardFailure(ip, giftCardLimit(strapi).windowMs);
          await maybeAlertProbing(ip, count, serviceCtx);
        }
        throw error;
      }
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

    /** POST /payments/session — X-Order-Token + {provider, returnUrl?}; wallet checkout (O13). */
    paymentSession: action('create', async (ctx, serviceCtx) =>
      storefront().paymentSessionByToken(
        orderToken(ctx),
        {
          ...((ctx.request.body ?? {}) as { provider?: unknown; returnUrl?: unknown }),
          ipAddr: clientIpOf(strapi, ctx),
        },
        serviceCtx,
      ),
    ),

    /** GET /payments/return/:provider — wallet return landing; display only, never captures. */
    paymentReturn: action('read', async (ctx) =>
      storefront().paymentReturn(
        typeof ctx.params.provider === 'string' ? ctx.params.provider : '',
        ctx.query as Record<string, unknown>,
      ),
    ),

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

    /** GET /orders/rating — X-Order-Token (O8). */
    rating: action('rating', async (ctx, serviceCtx) => ratings().viewByToken(orderToken(ctx), serviceCtx)),

    /** POST /orders/rating — `{ stars, tags?, comment? }` + X-Order-Token (O8). */
    rate: action('rating', async (ctx, serviceCtx) =>
      ratings().submitByToken(orderToken(ctx), ctx.request.body, serviceCtx),
    ),

    /** POST /orders/cancel — X-Order-Token; only while customer-cancellable. */
    cancel: action('create', async (ctx, serviceCtx) => {
      const body = (ctx.request.body ?? {}) as { reason?: unknown };
      const reason = typeof body.reason === 'string' ? body.reason.slice(0, 200) : undefined;
      return { order: await storefront().cancelByToken(orderToken(ctx), reason, serviceCtx) };
    }),
  };
};
