import type { Core } from '@strapi/strapi';

import { isOrderingError } from '../domain/errors';
import type catalogCategoryFactory from '../services/catalog-category';

interface AdminCtx {
  query: Record<string, unknown>;
  params: Record<string, string | undefined>;
  request: { body?: unknown };
  state: { user?: { id?: number; roles?: { code?: string }[] } };
  status: number;
  body: unknown;
}

type CatalogCategoryService = ReturnType<typeof catalogCategoryFactory>;

const fail = (ctx: AdminCtx, error: unknown): void => {
  if (isOrderingError(error)) {
    ctx.status = error.status;
    ctx.body = { error: { code: error.code, message: error.message, details: error.details } };
    return;
  }
  throw error;
};

/**
 * Admin API behind the "Danh mục" screen (plan step 7b). Every route requires
 * `admin::hasPermissions` on `plugin::ordering.catalog.manage`; writes return the
 * OrderingError code verbatim so the React page can map them to translated copy.
 */
export default ({ strapi }: { strapi: Core.Strapi }) => {
  const service = (): CatalogCategoryService =>
    strapi.plugin('ordering').service('catalog-category') as CatalogCategoryService;

  const ctxOf = async (ctx: AdminCtx) => service().contextFor(ctx.state.user ?? {});

  return {
    /** GET /categories?locale= — nested tree with product counts. */
    async tree(ctx: AdminCtx) {
      const locale = typeof ctx.query.locale === 'string' ? ctx.query.locale : 'vi';
      ctx.body = { items: await service().tree(locale) };
    },

    /** POST /categories — { name, slug?, description?, parent?, isActive?, isInternal? } */
    async create(ctx: AdminCtx) {
      try {
        const data = (ctx.request.body ?? {}) as Record<string, unknown>;
        const entry = await service().create(data, await ctxOf(ctx));
        ctx.status = 201;
        ctx.body = { item: entry };
      } catch (error) {
        fail(ctx, error);
      }
    },

    /** PUT /categories/:id — scalar fields; `parent` reparents (appended last). */
    async update(ctx: AdminCtx) {
      try {
        const documentId = ctx.params.id as string;
        const data = (ctx.request.body ?? {}) as Record<string, unknown>;
        const entry = await service().update(documentId, data, await ctxOf(ctx));
        ctx.body = { item: entry };
      } catch (error) {
        fail(ctx, error);
      }
    },

    /** POST /categories/:id/move — { parentId, index } one-transaction reparent+reorder. */
    async move(ctx: AdminCtx) {
      try {
        const documentId = ctx.params.id as string;
        const body = (ctx.request.body ?? {}) as { parentId?: string | null; index?: number };
        ctx.body = { item: await service().move(documentId, body, await ctxOf(ctx)) };
      } catch (error) {
        fail(ctx, error);
      }
    },

    /** DELETE /categories/:id — `?confirm=true` required while products are linked. */
    async remove(ctx: AdminCtx) {
      try {
        const documentId = ctx.params.id as string;
        const confirm =
          ctx.query.confirm === 'true' ||
          (ctx.request.body as { confirm?: boolean } | undefined)?.confirm === true;
        ctx.body = await service().remove(documentId, { confirm }, await ctxOf(ctx));
      } catch (error) {
        fail(ctx, error);
      }
    },
  };
};
