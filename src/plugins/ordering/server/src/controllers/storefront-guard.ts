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

/** Test helper: forget every bucket (limits are re-read from config). */
export const resetStorefrontLimiters = (): void => {
  limiters.clear();
};
