import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { OrderingError } from '../domain/errors';
import type cartFactory from '../services/cart';
import type { OrderingRegistry } from '../services/registry';
import type { HttpCtx } from './http';
import {
  clientIpOf,
  isWrongPromotionCode,
  notePromotionCodeFailure,
  PROMOTION_CAPTCHA_AFTER,
  promotionCodeFailureCount,
  promotionCodeLimit,
} from './storefront-guard';

type CartService = ReturnType<typeof cartFactory>;

/**
 * `set`: the request puts a code on the cart (create, PATCH with `promotionCode`) — a new guess,
 * so it is captcha-gated past the threshold. `stored`: the cart already carries a code (reads,
 * line changes, reorder) — no captcha, the guess was gated when the code was set.
 */
export type CartCodeMode = 'set' | 'stored';

/**
 * Each (IP, cart, code) counts as one guess, whenever it is first evaluated. A code set on an
 * empty cart is counted later, on the first request whose quote can judge it; re-reading the
 * cart never counts it again, so a customer with a stored wrong code is not locked out of
 * their own cart.
 */
const counted = new Map<string, number>();

const countOnce = (ip: string, cartId: string, code: string, windowMs: number, now = Date.now()): boolean => {
  if (counted.size >= 10_000) {
    for (const [key, until] of counted) if (now >= until) counted.delete(key);
  }
  const key = `${ip}|${cartId}|${code.trim().toUpperCase()}`;
  const until = counted.get(key);
  if (until !== undefined && now < until) return false;
  counted.set(key, now + windowMs);
  return true;
};

/** Test helper. */
export const resetCartCodeGuard = (): void => {
  counted.clear();
};

/** Guard every cart quote, including codes stored before the cart could be priced. */
export const withCartPromotionGuard = async <T extends Awaited<ReturnType<CartService['view']>>>(
  strapi: Core.Strapi,
  ctx: HttpCtx,
  code: unknown,
  mode: CartCodeMode,
  run: () => Promise<T>,
): Promise<T | undefined> => {
  const hasCode = typeof code === 'string' && code.trim() !== '';
  const ip = clientIpOf(strapi, ctx);
  const limit = promotionCodeLimit(strapi);
  const tooMany = () => {
    ctx.status = 429;
    ctx.body = { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } };
    return undefined;
  };
  if (hasCode && mode === 'set') {
    const failures = promotionCodeFailureCount(ip);
    if (failures >= limit.max) return tooMany();
    if (failures >= PROMOTION_CAPTCHA_AFTER) {
      const body = (ctx.request.body ?? {}) as Record<string, unknown>;
      const cfg = strapi.config.get('plugin::ordering') as OrderingConfig;
      if (cfg.storefront.captchaProvider) {
        const provider = (strapi.plugin('ordering').service('registry') as OrderingRegistry)
          .captchaProvider(cfg.storefront.captchaProvider);
        const result = await provider.verify({
          token: typeof body.captchaToken === 'string' ? body.captchaToken : '',
          ip,
          action: 'order-create',
        });
        if (!result.valid) {
          throw new OrderingError('CAPTCHA_FAILED', 'captcha verification failed', {
            details: { reason: result.code },
          });
        }
      }
    }
  }
  const view = await run();
  const rejected =
    (view.quote as { rejectedPromotions?: Array<{ reason: string }> } | null)?.rejectedPromotions ?? [];
  const storedCode = (view.cart as { promotionCode?: string | null }).promotionCode;
  if (
    hasCode &&
    storedCode &&
    rejected.some((row) => isWrongPromotionCode(row.reason)) &&
    countOnce(ip, String((view.cart as { id: string }).id), storedCode, limit.windowMs)
  ) {
    if (notePromotionCodeFailure(ip, limit.windowMs) >= limit.max) return tooMany();
  }
  return view;
};
