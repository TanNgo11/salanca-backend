import type { Core } from '@strapi/strapi';

/**
 * `proxy.koa` decides whether Koa derives `ctx.request.ip` from `X-Forwarded-For`.
 * Strapi defaults the whole `proxy` key to false, so behind a load balancer every
 * request reports the proxy's own address and the public-form rate limiters
 * collapse into one global bucket.
 *
 * Set KOA_TRUST_PROXY=true ONLY where a trusted proxy rewrites (not appends to)
 * X-Forwarded-For. With Strapi directly internet-facing it must stay false, or a
 * client can rotate the header and bypass rate limiting entirely.
 */
const config = ({ env }: Core.Config.Shared.ConfigParams): Core.Config.Server => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS')!,
  },
  proxy: {
    koa: env.bool('KOA_TRUST_PROXY', false),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
});

export default config;
