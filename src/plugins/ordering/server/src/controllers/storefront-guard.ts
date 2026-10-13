import type { Core } from '@strapi/strapi';

import type { OrderingConfig } from '../config';
import { resolveClientIp } from '../domain/client-ip';
import { InMemoryRateLimit } from '../domain/rate-limit';
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

const CODE_WINDOW_MS = 10 * 60 * 1000;
const codeFailures = new Map<string, { count: number; resetAt: number }>();

/**
 * Reasons that answer "does this code exist / is it live" — the guessing signal. Eligibility
 * misses (minimum subtotal, per-customer, receive kind…) on a real code do not count.
 */
const GUESS_REASONS = new Set(['invalid', 'not-started', 'ended', 'code-used', 'usage-limit']);

export const isWrongPromotionCode = (reason: string): boolean => GUESS_REASONS.has(reason);

/** Wrong promotion codes for this IP in the current 10-minute window. */
export const promotionCodeFailureCount = (ip: string, now = Date.now()): number => {
  const entry = codeFailures.get(ip);
  if (!entry || now >= entry.resetAt) return 0;
  return entry.count;
};

/** Counts one wrong code. Returns the new total for this window. */
export const notePromotionCodeFailure = (ip: string, now = Date.now()): number => {
  const entry = codeFailures.get(ip);
  if (!entry || now >= entry.resetAt) {
    codeFailures.set(ip, { count: 1, resetAt: now + CODE_WINDOW_MS });
    return 1;
  }
  entry.count += 1;
  return entry.count;
};

/** Test helper: forget every bucket (limits are re-read from config). */
export const resetStorefrontLimiters = (): void => {
  limiters.clear();
  codeFailures.clear();
};
