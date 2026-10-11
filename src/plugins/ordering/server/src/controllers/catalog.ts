import type { Core } from '@strapi/strapi';

import type { AdapterContext, Sellable } from '../contracts';
import type { OrderingConfig } from '../config';
import type { AvailabilityInput } from '../domain/catalog/availability';
import { serializeCategoryTree, serializeProduct } from '../domain/catalog/serialize';
import { resolveClientIp } from '../domain/client-ip';
import { getCatalogRateLimit } from '../domain/rate-limit';
import type { OrderingRegistry } from '../services/registry';

/** Minimal Koa context surface these read-only actions use. */
interface PublicCtx {
  query: Record<string, unknown>;
  params: Record<string, string | undefined>;
  ip?: string;
  request: { ip?: string; headers?: Record<string, string | string[] | undefined> };
  status: number;
  body: unknown;
  set(field: string, value: string): void;
}

const CACHE_CONTROL = 'public, max-age=30';

const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;

const errorBody = (ctx: PublicCtx, status: number, code: string, message: string): void => {
  ctx.status = status;
  ctx.body = { error: { code, message } };
};

/**
 * Public catalog API (contracts §20.2, plan step 7). Three read-only routes with
 * `auth: false`; every response is computed (price, options, per-location availability) and
 * sanitized to the storefront allowlist before it leaves.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const config = (): OrderingConfig => strapi.config.get('plugin::ordering') as OrderingConfig;
  const defaultLocale = () => config().catalog.defaultLocale;
  const adapter = () =>
    (strapi.plugin('ordering').service('registry') as OrderingRegistry).catalogAdapter(
      config().catalog.adapter,
    );

  const adapterContext = (ctx: PublicCtx): AdapterContext => ({
    now: new Date().toISOString(),
    locationRef: text(ctx.query.location),
    channel: 'web-checkout',
  });

  /** Fixed-window per-IP limit — read traffic is cheap but unauthenticated. */
  const rateLimited = (ctx: PublicCtx): boolean => {
    const ip = resolveClientIp(ctx, config().clientIp);
    const rate = getCatalogRateLimit().tryConsume(`catalog:${ip}`);
    if (rate.allowed) return false;
    ctx.set('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000) || 1));
    errorBody(ctx, 429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
    return true;
  };

  /** A sellable is public only when the catalog says "Đang bán" + "Bán online". */
  const publiclyVisible = (sellable: Sellable): boolean => {
    const input = sellable.metadata?.availabilityInput as AvailabilityInput | undefined;
    return input?.status === 'active' && input.sellOnline !== false;
  };

  return {
    /** GET /catalog/categories?locale= — nested tree, internal/inactive pruned. */
    async categories(ctx: PublicCtx) {
      ctx.set('Cache-Control', CACHE_CONTROL);
      if (rateLimited(ctx)) return;
      const locale = text(ctx.query.locale) ?? defaultLocale();
      const rows = await adapter().listCategories(adapterContext(ctx), { locale });
      ctx.body = { items: serializeCategoryTree(rows) };
    },

    /** GET /catalog/products?locale=&category=&location=&cursor=&limit= */
    async products(ctx: PublicCtx) {
      ctx.set('Cache-Control', CACHE_CONTROL);
      if (rateLimited(ctx)) return;
      const locale = text(ctx.query.locale) ?? defaultLocale();
      const rawLimit = Number.parseInt(text(ctx.query.limit) ?? '', 10);
      const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 50) : 24;
      const { items, nextCursor } = await adapter().listSellables(adapterContext(ctx), {
        locale,
        categoryRef: text(ctx.query.category),
        cursor: text(ctx.query.cursor),
        limit,
      });
      ctx.body = {
        items: items.map(serializeProduct),
        ...(nextCursor ? { nextCursor } : {}),
      };
    },

    /** GET /catalog/products/:slug?locale=&location= — slug or documentId. */
    async product(ctx: PublicCtx) {
      ctx.set('Cache-Control', CACHE_CONTROL);
      if (rateLimited(ctx)) return;
      const slug = text(ctx.params.slug);
      if (!slug) {
        errorBody(ctx, 404, 'NOT_FOUND', 'Product not found.');
        return;
      }
      const locale = text(ctx.query.locale) ?? defaultLocale();
      const sellable = await adapter().getSellable(adapterContext(ctx), { uid: slug }, { locale });
      if (!sellable || !publiclyVisible(sellable)) {
        errorBody(ctx, 404, 'NOT_FOUND', 'Product not found.');
        return;
      }
      ctx.body = { item: serializeProduct(sellable) };
    },
  };
};
