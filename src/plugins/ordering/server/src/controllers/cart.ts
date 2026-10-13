import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import { LIMITS, parseIdempotencyKey } from '../domain/storefront/parse';
import type cartFactory from '../services/cart';
import type { ServiceContext } from '../services/context';
import type { OrderingRegistry } from '../services/registry';
import type storefrontFactory from '../services/storefront';
import type { HttpCtx } from './http';
import { sendError } from './http';
import { sessionFor } from './customer-auth';
import { clientIpOf, rateLimited } from './storefront-guard';

type CartService = ReturnType<typeof cartFactory>;
type StorefrontService = ReturnType<typeof storefrontFactory>;

const cartTokenOf = (ctx: HttpCtx): string | undefined => ctx.get('x-cart-token') || undefined;

/**
 * Public `/carts*` (O11 step 4). A cart is identified by `X-Cart-Token` (guest) and/or
 * `X-Customer-Token` (session) — when both arrive the guest cart merges into the customer's.
 * Every mutating call answers `{cart, quote, issues}` re-quoted server-side; checkout answers
 * like `POST /orders` and marks the cart converted.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const carts = () => strapi.plugin('ordering').service('cart') as CartService;
  const storefront = () => strapi.plugin('ordering').service('storefront') as StorefrontService;
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;

  const customerCtx = (): ServiceContext => ({
    actor: { kind: 'customer' },
    requestId: randomUUID(),
  });

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

  /** Both headers are optional here; the service resolves identity and merges. */
  const owner = async (ctx: HttpCtx, serviceCtx: ServiceContext) => {
    const session = await sessionFor(strapi, ctx, serviceCtx);
    return { customerId: session?.customer.id ?? null, cartToken: cartTokenOf(ctx) };
  };

  const action =
    (
      bucket: Parameters<typeof rateLimited>[2],
      run: (ctx: HttpCtx, serviceCtx: ServiceContext) => Promise<unknown>,
    ) =>
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
        const result = await run(ctx, serviceCtx);
        if (result !== undefined) ctx.body = result;
      } catch (error) {
        sendError(ctx, error, serviceCtx.requestId);
      }
    };

  /** Resolve the cart, run the mutation, answer `{cart, quote, issues}` re-quoted. */
  const mutate =
    (
      bucket: Parameters<typeof rateLimited>[2],
      run: (
        ctx: HttpCtx,
        serviceCtx: ServiceContext,
        cartRow: Awaited<ReturnType<CartService['resolve']>>,
      ) => Promise<void>,
    ) =>
    action(bucket, async (ctx, serviceCtx) => {
      const cartRow = await carts().resolve(await owner(ctx, serviceCtx), serviceCtx);
      await run(ctx, serviceCtx, cartRow);
      return carts().view(await carts().resolve(await owner(ctx, serviceCtx), serviceCtx), serviceCtx);
    });

  return {
    /** POST /carts — guest → `{cartToken}` (once); signed-in → the customer's cart. */
    create: action('auth', async (ctx, serviceCtx) => {
      const { row, cartToken } = await carts().create(
        (ctx.request.body ?? {}) as Record<string, unknown>,
        { customerId: (await owner(ctx, serviceCtx)).customerId },
        serviceCtx,
      );
      ctx.status = 201;
      return {
        ...(cartToken ? { cartToken } : {}),
        ...(await carts().view(row, serviceCtx)),
      };
    }),

    /** GET /carts/current — the resolved cart re-quoted; 404/410 when absent/dead. */
    current: action('read', async (ctx, serviceCtx) =>
      carts().view(await carts().resolve(await owner(ctx, serviceCtx), serviceCtx), serviceCtx),
    ),

    /** PATCH /carts/current — branch/receiveMethod/pickup/contact/locale. */
    patch: mutate('auth', async (ctx, serviceCtx, cartRow) => {
      await carts().patch(
        cartRow,
        (ctx.request.body ?? {}) as Record<string, unknown>,
        serviceCtx,
      );
    }),

    /** POST /carts/current/lines — add a line (identical signature tops up quantity). */
    addLine: mutate('auth', async (ctx, serviceCtx, cartRow) => {
      await carts().addLine(
        cartRow,
        (ctx.request.body ?? {}) as Record<string, unknown>,
        serviceCtx,
      );
    }),

    /** PATCH /carts/current/lines/:lineId — quantity/selected/note. */
    updateLine: mutate('auth', async (ctx, serviceCtx, cartRow) => {
      await carts().updateLine(
        cartRow,
        ctx.params.lineId ?? '',
        (ctx.request.body ?? {}) as Record<string, unknown>,
        serviceCtx,
      );
    }),

    /** DELETE /carts/current/lines/:lineId — remove a line (404 for foreign ids). */
    removeLine: mutate('auth', async (ctx, serviceCtx, cartRow) => {
      await carts().removeLine(cartRow, ctx.params.lineId ?? '', serviceCtx);
    }),

    /**
     * POST /carts/current/checkout — `{consent{policyVersion,accepted}, payment?,
     * captchaToken, idempotencyKey?}` + `Idempotency-Key` header alternative. Answers like
     * `POST /orders` ({order, token, replayed}); the cart flips to converted.
     */
    checkout: action('create', async (ctx, serviceCtx) => {
      const body = (ctx.request.body ?? {}) as Record<string, unknown>;
      const idempotencyKey = ctx.get('idempotency-key')
        ? parseIdempotencyKey(ctx.get('idempotency-key'))
        : parseIdempotencyKey(body.idempotencyKey);
      const consent = body.consent as { policyVersion?: unknown; accepted?: unknown; marketingOptIn?: unknown } | undefined;
      if (!consent || typeof consent.policyVersion !== 'string' || consent.accepted !== true) {
        throw new OrderingError('CONSENT_REQUIRED', 'consent to process personal data is required', {
          details: { field: 'consent' },
        });
      }
      await verifyCaptcha(
        ctx,
        typeof body.captchaToken === 'string' ? body.captchaToken : undefined,
        'cart-checkout',
      );
      const cartRow = await carts().resolve(await owner(ctx, serviceCtx), serviceCtx, {
        allowConverted: true, // same-key retry must reach createOrder's replay path
      });
      const payment =
        typeof body.payment === 'object' && body.payment !== null
          ? { providerCode: String((body.payment as Record<string, unknown>).providerCode ?? '') }
          : undefined;
      const result = await carts().checkout(
        cartRow,
        {
          consent: {
            policyVersion: consent.policyVersion,
            marketingOptIn: consent.marketingOptIn === true,
          },
          ...(payment ? { payment } : {}),
          idempotencyKey,
          customerId: (await owner(ctx, serviceCtx)).customerId,
        },
        serviceCtx,
      );
      const view = await storefront().viewByToken(result.publicToken, serviceCtx);
      ctx.status = result.replayed ? 200 : 201;
      return { order: view, token: result.publicToken, replayed: result.replayed };
    }),
  };
};
