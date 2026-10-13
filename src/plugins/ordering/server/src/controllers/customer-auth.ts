import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import { InMemoryRateLimit } from '../domain/rate-limit';
import type customerAuthFactory from '../services/customer-auth';
import type { ServiceContext } from '../services/context';
import type { OrderingRegistry } from '../services/registry';
import { LIMITS } from '../domain/storefront/parse';
import type { HttpCtx } from './http';
import { sendError } from './http';
import { clientIpOf, rateLimited } from './storefront-guard';

type CustomerAuthService = ReturnType<typeof customerAuthFactory>;

const customerAuth = (strapi: Core.Strapi): CustomerAuthService =>
  strapi.plugin('ordering').service('customer-auth') as CustomerAuthService;

export const customerTokenOf = (ctx: HttpCtx): string | undefined =>
  ctx.get('x-customer-token') || undefined;

/** `X-Customer-Token` → live {customer, session} or null (Step 3 controllers reuse this). */
export const sessionFor = (strapi: Core.Strapi, ctx: HttpCtx, serviceCtx: ServiceContext) =>
  customerAuth(strapi).resolveSession(customerTokenOf(ctx), serviceCtx);

/** Same but throws `CUSTOMER_AUTH_REQUIRED` (401) when the token is absent/dead. */
export const requireCustomer = async (
  strapi: Core.Strapi,
  ctx: HttpCtx,
  serviceCtx: ServiceContext,
) => {
  const resolved = await sessionFor(strapi, ctx, serviceCtx);
  if (!resolved) {
    throw new OrderingError('CUSTOMER_AUTH_REQUIRED', 'a customer session is required');
  }
  return resolved;
};

/**
 * Public `/auth/*` (O11 step 2): OTP request/verify and logout. The generic `auth` rate-limit
 * bucket guards every action; `requestOtp` adds the persistent per-IP send cap
 * (`customers.otp.ipMaxPerHour`) on top — the in-memory bucket alone resets on restart.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const config = () => strapi.config.get('plugin::ordering') as OrderingConfig;
  const auth = () => customerAuth(strapi);

  const customerCtx = (): ServiceContext => ({
    actor: { kind: 'customer' },
    requestId: randomUUID(),
  });

  let otpIpLimiter: InMemoryRateLimit | null = null;
  const otpIpLimited = (ctx: HttpCtx): boolean => {
    if (!otpIpLimiter) {
      otpIpLimiter = new InMemoryRateLimit({
        max: config().customers.otp.ipMaxPerHour,
        windowMs: 3_600_000,
      });
    }
    const result = otpIpLimiter.tryConsume(`otp-ip:${clientIpOf(strapi, ctx)}`);
    if (result.allowed) return false;
    ctx.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000) || 1));
    ctx.status = 429;
    ctx.body = { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } };
    return true;
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

  const action =
    (run: (ctx: HttpCtx, serviceCtx: ServiceContext) => Promise<unknown>) =>
    async (ctx: HttpCtx) => {
      const serviceCtx = customerCtx();
      if (rateLimited(strapi, ctx, 'auth')) return;
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

  return {
    /** POST /auth/otp {channel:'email', target, captchaToken?} → {challengeId}. Always 200. */
    requestOtp: action(async (ctx, serviceCtx) => {
      const input = (ctx.request.body ?? {}) as {
        channel?: unknown;
        target?: unknown;
        captchaToken?: unknown;
      };
      await verifyCaptcha(
        ctx,
        typeof input.captchaToken === 'string' ? input.captchaToken : undefined,
        'otp-request',
      );
      if (otpIpLimited(ctx)) return undefined;
      return auth().requestOtp({ channel: input.channel, target: input.target }, serviceCtx);
    }),

    /** POST /auth/verify {challengeId, code} → {token, customer} or the OTP error codes. */
    verify: action(async (ctx, serviceCtx) => {
      const input = (ctx.request.body ?? {}) as { challengeId?: unknown; code?: unknown };
      return auth().verifyOtp(
        { ...input, userAgent: ctx.get('user-agent') || undefined },
        serviceCtx,
      );
    }),

    /** POST /auth/logout — X-Customer-Token → 204. No token needed: unknown tokens no-op. */
    logout: action(async (ctx, serviceCtx) => {
      await auth().logoutByToken(customerTokenOf(ctx), serviceCtx);
      ctx.status = 204;
      return undefined;
    }),
  };
};
