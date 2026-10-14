import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { resolveClientIp } from '../domain/client-ip';
import { InMemoryRateLimit } from '../domain/rate-limit';
import type { ServiceContext } from '../services/context';
import type { HttpCtx } from './http';

type Bucket = keyof OrderingConfig['storefront']['rateLimits'];

/**
 * Per-process fixed-window limiters for the storefront API (contracts §21.8, §21.9: one instance
 * in v1). One limiter per bucket, created lazily from plugin config.
 */
const limiters = new Map<Bucket, InMemoryRateLimit>();

const limiterFor = (strapi: Core.Strapi, bucket: Bucket): InMemoryRateLimit => {
  let limiter = limiters.get(bucket);
  if (!limiter) {
    const config = strapi.config.get('plugin::ordering') as OrderingConfig;
    limiter = new InMemoryRateLimit(config.storefront.rateLimits[bucket]);
    limiters.set(bucket, limiter);
  }
  return limiter;
};

export const clientIpOf = (strapi: Core.Strapi, ctx: HttpCtx): string =>
  resolveClientIp(ctx, (strapi.config.get('plugin::ordering') as OrderingConfig).clientIp);

/**
 * Consumes one unit of `bucket` for `key` (default: the client IP). On refusal answers 429 with
 * `Retry-After` and the standard error body, and returns true.
 */
export const rateLimited = (
  strapi: Core.Strapi,
  ctx: HttpCtx,
  bucket: Bucket,
  key: string = clientIpOf(strapi, ctx),
): boolean => {
  const result = limiterFor(strapi, bucket).tryConsume(`${bucket}:${key}`);
  if (result.allowed) return false;
  ctx.set('Retry-After', String(Math.ceil(result.retryAfterMs / 1000) || 1));
  ctx.status = 429;
  ctx.body = { error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' } };
  return true;
};

/** Wrong codes per IP before a quote with a code must carry a captcha (plan O8 step 4). */
export const PROMOTION_CAPTCHA_AFTER = 3;
const codeFailures = new Map<string, { count: number; resetAt: number }>();

/**
 * Reasons that answer "does this code exist / is it live" — the guessing signal. Eligibility
 * misses (minimum subtotal, per-customer, receive kind…) on a real code do not count.
 */
const GUESS_REASONS = new Set(['invalid', 'not-started', 'ended', 'code-used', 'usage-limit']);

export const isWrongPromotionCode = (reason: string): boolean => GUESS_REASONS.has(reason);

/** `storefront.rateLimits.promotionCode`: `max` wrong codes per IP in `windowMs`, then 429. */
export const promotionCodeLimit = (strapi: Core.Strapi): { max: number; windowMs: number } =>
  (strapi.config.get('plugin::ordering') as OrderingConfig).storefront.rateLimits.promotionCode;

/** Wrong promotion codes for this IP in the current window. */
export const promotionCodeFailureCount = (ip: string, now = Date.now()): number => {
  const entry = codeFailures.get(ip);
  if (!entry || now >= entry.resetAt) return 0;
  return entry.count;
};

/** Counts one wrong code. Returns the new total for this window. */
export const notePromotionCodeFailure = (ip: string, windowMs: number, now = Date.now()): number => {
  if (codeFailures.size >= 10_000) {
    for (const [key, entry] of codeFailures) if (now >= entry.resetAt) codeFailures.delete(key);
  }
  const entry = codeFailures.get(ip);
  if (!entry || now >= entry.resetAt) {
    codeFailures.set(ip, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
};

/** Wrong card codes per IP before a lookup must carry a captcha (O9: đoán mã probing). */
export const GIFT_CARD_CAPTCHA_AFTER = 3;
const cardFailures = new Map<string, { count: number; resetAt: number }>();

/** `storefront.rateLimits.giftCard`: `max` wrong card codes per IP in `windowMs`, then 429. */
export const giftCardLimit = (strapi: Core.Strapi): { max: number; windowMs: number } =>
  (strapi.config.get('plugin::ordering') as OrderingConfig).storefront.rateLimits.giftCard;

/** Wrong card codes for this IP in the current window. */
export const giftCardFailureCount = (ip: string, now = Date.now()): number => {
  const entry = cardFailures.get(ip);
  if (!entry || now >= entry.resetAt) return 0;
  return entry.count;
};

/** Counts one wrong card code. Returns the new total for this window. */
export const noteGiftCardFailure = (ip: string, windowMs: number, now = Date.now()): number => {
  if (cardFailures.size >= 10_000) {
    for (const [key, entry] of cardFailures) if (now >= entry.resetAt) cardFailures.delete(key);
  }
  const entry = cardFailures.get(ip);
  if (!entry || now >= entry.resetAt) {
    cardFailures.set(ip, { count: 1, resetAt: now + windowMs });
    return 1;
  }
  entry.count += 1;
  return entry.count;
};

/** Test helper: forget every bucket (limits are re-read from config). */
export const resetStorefrontLimiters = (): void => {
  limiters.clear();
  codeFailures.clear();
  cardFailures.clear();
};

/**
 * O9: once one IP's wrong-card-code count reaches the `gift-card-probing` threshold the ops
 * board gets one alert per IP (dedupeKey); further failures bump its count and the alert
 * escalates at `criticalThreshold`. Shares the in-memory limiter window — a process restart
 * resets both. Alerting must never break a public request.
 */
export const alertGiftCardProbing = async (
  strapi: Core.Strapi,
  ip: string,
  count: number,
  serviceCtx: ServiceContext,
): Promise<void> => {
  try {
    const rule = await (
      strapi.plugin('ordering').service('alert-rules') as ReturnType<
        typeof import('../services/alert-rules').default
      >
    ).ruleOf('gift-card-probing');
    if (!rule.enabled || count < rule.threshold) return;
    await (
      strapi.plugin('ordering').service('alert') as ReturnType<typeof import('../services/alert').default>
    ).open(
      {
        alertCode: 'gift-card-probing',
        dedupeKey: `gift-card-probing:${ip}`,
        severity:
          rule.criticalThreshold !== undefined && count >= rule.criticalThreshold
            ? 'critical'
            : 'warning',
        aggregateRef: `${count} wrong codes`,
      },
      serviceCtx,
    );
  } catch (error) {
    // alerting must never break a public request — warn so a broken pipeline is visible
    strapi.log.warn(`[ordering] gift-card-probing alert failed: ${(error as Error).message}`);
  }
};
