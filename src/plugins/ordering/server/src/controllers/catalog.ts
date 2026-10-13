import { randomUUID } from 'node:crypto';

import type { Core } from '@strapi/strapi';

import type { AdapterContext, Sellable } from '../contracts';
import type { OrderingConfig } from '../config';
import { priceChannelOf } from '../domain/catalog/price-selection';
import type { AvailabilityInput } from '../domain/catalog/availability';
import { serializeCategoryTree, serializeProduct, type DailyStockView } from '../domain/catalog/serialize';
import { businessDate } from '../domain/business-date';
import { catalogDailyRefs, dailyStockKey } from '../domain/daily-stock-lines';
import type dailyStockFactory from '../services/daily-stock';
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
const PRIVATE_CACHE = 'private, no-store';
const RECEIVE_KINDS = new Set(['pickup', 'delivery', 'dine-in']);

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

  const locationOf = (ctx: PublicCtx): string | undefined =>
    text(ctx.query.branch) ?? text(ctx.query.location);

  const tokenOf = (ctx: PublicCtx): string | undefined => {
    const raw = ctx.request.headers?.['x-customer-token'];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value && value.trim() !== '' ? value.trim() : undefined;
  };

  /**
   * A live customer session prices the catalog for that person's groups and must not be
   * stored by a shared cache. A missing or dead token stays on the public price.
   */
  const sessionGroups = async (ctx: PublicCtx): Promise<string[] | undefined> => {
    const token = tokenOf(ctx);
    if (!token) return undefined;
    const auth = strapi.plugin('ordering').service('customer-auth') as {
      resolveSession(
        token: string | undefined,
        ctx: { actor: { kind: 'customer' }; requestId: string },
      ): Promise<{ customer: { id: number } } | null>;
    };
    const session = await auth.resolveSession(token, { actor: { kind: 'customer' }, requestId: randomUUID() });
    if (!session) return undefined;
    const groups = strapi.plugin('ordering').service('customer-group') as {
      codesForCustomer(customerId: number): Promise<string[]>;
    };
    return groups.codesForCustomer(session.customer.id);
  };

  const adapterContext = async (ctx: PublicCtx): Promise<AdapterContext | undefined> => {
    const requested = text(ctx.query.receiveKind);
    if (requested && !RECEIVE_KINDS.has(requested)) {
      errorBody(ctx, 400, 'VALIDATION_ERROR', 'receiveKind must be pickup, delivery or dine-in.');
      return undefined;
    }
    const at = text(ctx.query.at);
    const now = at && !Number.isNaN(Date.parse(at)) ? new Date(at) : new Date();
    const locationRef = locationOf(ctx);
    let timezone: string | undefined;
    if (locationRef) {
      const branch = (await strapi.db.query('plugin::ordering.branch').findOne({
        where: { code: locationRef },
        select: ['timezone'],
      })) as { timezone?: string } | null;
      timezone = branch?.timezone;
    }
    const customerGroups = await sessionGroups(ctx);
    return {
      now: now.toISOString(),
      locationRef,
      channel: priceChannelOf({ receiveKind: requested }),
      ...(customerGroups ? { customerGroups } : {}),
      ...(timezone ? { timezone } : { timezone: 'Asia/Ho_Chi_Minh' }),
    };
  };

  const cacheFor = (ctx: PublicCtx, context: AdapterContext) => {
    ctx.set('Cache-Control', context.customerGroups ? PRIVATE_CACHE : CACHE_CONTROL);
  };

  const cutoffOf = (fulfillment: unknown): string => {
    const root = fulfillment && typeof fulfillment === 'object' ? (fulfillment as Record<string, unknown>) : {};
    for (const kind of ['pickup', 'delivery'] as const) {
      const method = root[kind] as { schedule?: { businessDayPolicy?: { cutoffLocalTime?: string } } } | undefined;
      const cutoff = method?.schedule?.businessDayPolicy?.cutoffLocalTime;
      if (typeof cutoff === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(cutoff)) return cutoff;
    }
    return config().businessDay?.cutoffLocalTime ?? '04:00';
  };

  /** Portion overlay for `?branch=` or `?location=`. No branch → the catalog stays unlimited. */
  const dailyView = async (ctx: PublicCtx, sellables: Sellable[]): Promise<DailyStockView | undefined> => {
    const locationRef = locationOf(ctx);
    if (!locationRef || sellables.length === 0) return undefined;
    const branch = (await strapi.db.query('plugin::ordering.branch').findOne({
      where: { code: locationRef },
    })) as { timezone?: string; fulfillment?: unknown } | null;
    if (!branch) return undefined;
    const requested = text(ctx.query.date);
    const date =
      requested && /^\d{4}-\d{2}-\d{2}$/.test(requested)
        ? requested
        : businessDate(new Date(), branch.timezone ?? 'Asia/Ho_Chi_Minh', cutoffOf(branch.fulfillment));
    const seen = new Set<string>();
    const refs: Array<{ entityType: 'product' | 'variant' | 'modifier'; entityDocumentId: string }> = [];
    for (const sellable of sellables) {
      for (const ref of catalogDailyRefs(sellable)) {
        const key = dailyStockKey(ref.entityType, ref.entityDocumentId);
        if (seen.has(key)) continue;
        seen.add(key);
        refs.push(ref);
      }
    }
    if (refs.length === 0) return undefined;
    const stock = await (
      strapi.plugin('ordering').service('daily-stock') as ReturnType<typeof dailyStockFactory>
    ).remaining(locationRef, date, refs);
    const remainingByKey = new Map<string, number>();
    for (const [key, row] of stock) remainingByKey.set(key, row.remaining);
    return { date, remainingByKey };
  };

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
      if (rateLimited(ctx)) return;
      const context = await adapterContext(ctx);
      if (!context) return;
      cacheFor(ctx, context);
      const locale = text(ctx.query.locale) ?? defaultLocale();
      const rows = await adapter().listCategories(context, { locale });
      ctx.body = { items: serializeCategoryTree(rows) };
    },

    /** GET /catalog/products?locale=&category=&location=&receiveKind=&cursor=&limit= */
    async products(ctx: PublicCtx) {
      if (rateLimited(ctx)) return;
      const context = await adapterContext(ctx);
      if (!context) return;
      cacheFor(ctx, context);
      const locale = text(ctx.query.locale) ?? defaultLocale();
      const rawLimit = Number.parseInt(text(ctx.query.limit) ?? '', 10);
      const limit = Number.isFinite(rawLimit) && rawLimit >= 1 ? Math.min(rawLimit, 50) : 24;
      const { items, nextCursor } = await adapter().listSellables(context, {
        locale,
        categoryRef: text(ctx.query.category),
        cursor: text(ctx.query.cursor),
        limit,
      });
      const daily = await dailyView(ctx, items);
      ctx.body = {
        items: items.map((item) => serializeProduct(item, daily)),
        ...(nextCursor ? { nextCursor } : {}),
      };
    },

    /** GET /catalog/products/:slug?locale=&location= — slug or documentId. */
    async product(ctx: PublicCtx) {
      if (rateLimited(ctx)) return;
      const context = await adapterContext(ctx);
      if (!context) return;
      cacheFor(ctx, context);
      const slug = text(ctx.params.slug);
      if (!slug) {
        errorBody(ctx, 404, 'NOT_FOUND', 'Product not found.');
        return;
      }
      const locale = text(ctx.query.locale) ?? defaultLocale();
      const sellable = await adapter().getSellable(context, { uid: slug }, { locale });
      if (!sellable || !publiclyVisible(sellable)) {
        errorBody(ctx, 404, 'NOT_FOUND', 'Product not found.');
        return;
      }
      ctx.body = { item: serializeProduct(sellable, await dailyView(ctx, [sellable])) };
    },
  };
};
