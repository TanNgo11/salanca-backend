import type { Core } from '@strapi/strapi';

import {
  type CategoryLike,
  buildCategoryTree,
  siblingRanks,
  wouldCreateCycle,
} from '../domain/catalog/category-tree';
import { withAuditSuppressed } from '../domain/audit/suppress';
import { resolveLocalizedText } from '../domain/catalog/localized-text';
import { OrderingError } from '../domain/errors';
import type { ServiceContext } from './context';
import type changeLogFactory from './change-log';
import type scopeFactory from './scope';

const CATEGORY = 'plugin::ordering.catalog-category';
/** Join tables created by migration 0002 — schema.mjs asserts they keep these names. */
const CATEGORY_PRODUCT_LINK = 'plugins_ordering_catalog_product_categories_lnk';
const PRODUCT_TABLE = 'plugins_ordering_catalog_product';

type CategoryRow = {
  id: number;
  documentId: string;
  name?: Record<string, string>;
  description?: Record<string, string> | null;
  slug?: Record<string, string> | null;
  rank?: number;
  isActive?: boolean;
  isInternal?: boolean;
  parent?: { id?: number; documentId?: string } | null;
};

const toLike = (row: CategoryRow): CategoryLike => ({
  ref: row.documentId,
  parentRef: row.parent?.documentId ?? null,
  rank: row.rank ?? 0,
});

const pickName = (name: Record<string, string> | undefined, locale: string): string =>
  resolveLocalizedText(name, locale, 'vi') ?? '';

/**
 * Category management for the "Danh mục" admin screen (plan step 7b): tree with product
 * counts, create/update/delete, and a transactional `move` that re-ranks siblings. All writes
 * go through the Document Service so localized-text validation and slug sync still run; the
 * delete guard lives here because Content Manager can't express it. Every write appends an
 * `admin-change-log` row.
 */
const catalogCategory = ({ strapi }: { strapi: Core.Strapi }) => {
  const categories = () => strapi.db.query(CATEGORY);
  const changeLog = () =>
    strapi.plugin('ordering').service('change-log') as ReturnType<typeof changeLogFactory>;
  const scope = () =>
    strapi.plugin('ordering').service('scope') as ReturnType<typeof scopeFactory>;

  const allRows = async (): Promise<CategoryRow[]> =>
    (await categories().findMany({
      populate: { parent: { select: ['documentId'] } },
    })) as CategoryRow[];

  const findOr404 = async (documentId: string): Promise<CategoryRow> => {
    const row = (await categories().findOne({
      where: { documentId },
      populate: { parent: { select: ['documentId'] } },
    })) as CategoryRow | null;
    if (!row) {
      throw new OrderingError('CATEGORY_NOT_FOUND', 'category not found', {
        details: { documentId },
      });
    }
    return row;
  };

  /** Direct child count by category id — one grouped query over the join table. */
  const productCounts = async (): Promise<Map<number, number>> => {
    const grouped = (await strapi.db
      .connection(CATEGORY_PRODUCT_LINK)
      .select('catalog_category_id')
      .count('* as cnt')
      .groupBy('catalog_category_id')) as { catalog_category_id: number; cnt: string | number }[];
    return new Map(grouped.map((row) => [row.catalog_category_id, Number(row.cnt)]));
  };

  /** jsonb via `strapi.db.connection` arrives unparsed — the ORM layer does that itself. */
  const asNameMap = (value: unknown): Record<string, string> => {
    if (value && typeof value === 'object') return value as Record<string, string>;
    if (typeof value === 'string') {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === 'object') return parsed as Record<string, string>;
      } catch {
        return {};
      }
    }
    return {};
  };

  /** Products linked to a category (for the delete guard and its response). */
  const linkedProducts = async (
    categoryRowId: number,
  ): Promise<{ id: number; documentId: string; name: Record<string, string> }[]> => {
    const rows = (await strapi.db
      .connection(`${CATEGORY_PRODUCT_LINK} as lnk`)
      .join(`${PRODUCT_TABLE} as p`, 'p.id', 'lnk.catalog_product_id')
      .where('lnk.catalog_category_id', categoryRowId)
      .select('p.id', 'p.document_id as documentId', 'p.name')) as {
      id: number;
      documentId: string;
      name: unknown;
    }[];
    return rows.map((row) => ({ ...row, name: asNameMap(row.name) }));
  };

  /**
   * Reparent + reposition inside one transaction: normalizes ranks on both the old and the
   * new sibling set. `index` is clamped into the target sibling range.
   */
  const moveRow = async (
    rows: CategoryRow[],
    documentId: string,
    parentRef: string | null,
    index: number,
  ) => {
    const likes = rows.map(toLike);
    if (wouldCreateCycle(likes, documentId, parentRef)) {
      throw new OrderingError('CATEGORY_MOVE_CYCLE', 'a category cannot move into its own subtree', {
        details: { documentId, parentRef },
      });
    }
    const byRef = new Map(rows.map((row) => [row.documentId, row]));
    if (parentRef !== null && !byRef.has(parentRef)) {
      throw new OrderingError('CATEGORY_NOT_FOUND', 'parent category not found', {
        details: { parentRef },
      });
    }
    const targetSiblings = rows
      .filter((row) => (row.parent?.documentId ?? null) === parentRef && row.documentId !== documentId)
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((row) => row.documentId);
    const at = Math.max(0, Math.min(index, targetSiblings.length));
    targetSiblings.splice(at, 0, documentId);
    const writes = new Map<string, number>();
    for (const [ref, rank] of siblingRanks(targetSiblings)) writes.set(ref, rank);
    if (parentRef !== (byRef.get(documentId)?.parent?.documentId ?? null)) {
      // Reparenting: dense-rank the old sibling set too so no gaps are left behind.
      const oldParent = byRef.get(documentId)?.parent?.documentId ?? null;
      const oldSiblings = rows
        .filter((row) => (row.parent?.documentId ?? null) === oldParent && row.documentId !== documentId)
        .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
        .map((row) => row.documentId);
      for (const [ref, rank] of siblingRanks(oldSiblings)) writes.set(ref, rank);
    }
    for (const [ref, rank] of writes) {
      const row = byRef.get(ref);
      if (!row) continue;
      const data: Record<string, unknown> = { rank };
      if (ref === documentId) {
        data.parent = parentRef === null ? null : byRef.get(parentRef)?.id ?? null;
      }
      if (data.rank !== row.rank || ref === documentId) {
        await categories().update({ where: { documentId: ref }, data });
      }
    }
  };

  return {
    /** Nested tree for the admin screen, each node carrying `productCount`. */
    async tree(locale = 'vi') {
      const [rows, counts] = await Promise.all([allRows(), productCounts()]);
      const items = rows.map((row) => ({
        ...toLike(row),
        name: pickName(row.name, locale),
        names: row.name ?? {},
        slugs: row.slug ?? {},
        descriptions: row.description ?? {},
        isActive: row.isActive !== false,
        isInternal: row.isInternal === true,
        productCount: counts.get(row.id) ?? 0,
      }));
      return buildCategoryTree(items);
    },

    async create(data: Record<string, unknown>, ctx: ServiceContext) {
      const parentId = (data.parent as string | null | undefined) ?? null;
      const created = await strapi.db.transaction(async () => {
        const entry = (await withAuditSuppressed(CATEGORY, () => strapi.documents(CATEGORY).create({
          data: {
            name: data.name,
            description: data.description,
            slug: data.slug,
            isActive: data.isActive ?? true,
            isInternal: data.isInternal ?? false,
            ...(data.image !== undefined ? { image: data.image } : {}),
            ...(parentId ? { parent: parentId } : {}),
          } as Record<string, unknown>,
        }))) as { documentId: string };
        // New children append at the end of the sibling list.
        const rows = await allRows();
        await moveRow(rows, entry.documentId, parentId, Number.MAX_SAFE_INTEGER);
        return entry;
      });
      await changeLog().record(
        {
          action: 'catalog-category.create',
          entityType: 'catalog-category',
          entityId: created.documentId,
          after: data,
        },
        ctx,
      );
      return created;
    },

    async update(documentId: string, data: Record<string, unknown>, ctx: ServiceContext) {
      const before = await findOr404(documentId);
      const updated = await strapi.db.transaction(async () => {
        const entry = (await withAuditSuppressed(CATEGORY, () => strapi.documents(CATEGORY).update({
          documentId,
          data: {
            ...(data.name !== undefined ? { name: data.name } : {}),
            ...(data.description !== undefined ? { description: data.description } : {}),
            ...(data.slug !== undefined ? { slug: data.slug } : {}),
            ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
            ...(data.isInternal !== undefined ? { isInternal: data.isInternal } : {}),
            ...(data.image !== undefined ? { image: data.image } : {}),
          } as Record<string, unknown>,
        }))) as { documentId: string };
        if (data.parent !== undefined) {
          const rows = await allRows();
          await moveRow(
            rows,
            documentId,
            (data.parent as string | null) ?? null,
            Number.MAX_SAFE_INTEGER,
          );
        }
        return entry;
      });
      await changeLog().record(
        {
          action: 'catalog-category.update',
          entityType: 'catalog-category',
          entityId: documentId,
          before: before as unknown as Record<string, unknown>,
          after: data,
        },
        ctx,
      );
      return updated;
    },

    /** move(documentId, { parentId, index }) — one transaction, dense sibling ranks. */
    async move(
      documentId: string,
      input: { parentId?: string | null; index?: number },
      ctx: ServiceContext,
    ) {
      const before = await findOr404(documentId);
      const parentRef = input.parentId === undefined ? (before.parent?.documentId ?? null) : input.parentId;
      await strapi.db.transaction(async () => {
        const rows = await allRows();
        const currentIndex = rows
          .filter((row) => (row.parent?.documentId ?? null) === parentRef)
          .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
          .findIndex((row) => row.documentId === documentId);
        await moveRow(
          rows,
          documentId,
          parentRef,
          input.index ?? (currentIndex < 0 ? Number.MAX_SAFE_INTEGER : currentIndex),
        );
      });
      await changeLog().record(
        {
          action: 'catalog-category.move',
          entityType: 'catalog-category',
          entityId: documentId,
          before: { parent: before.parent?.documentId ?? null, rank: before.rank ?? 0 },
          after: { parent: parentRef, index: input.index ?? null },
        },
        ctx,
      );
      return { documentId, parentId: parentRef };
    },

    /**
     * Delete guards (spec 7b): children block; products require `confirm`. On a confirmed
     * delete the product links are removed and the response reports products left without
     * any category.
     */
    async remove(
      documentId: string,
      input: { confirm?: boolean },
      ctx: ServiceContext,
    ): Promise<{
      deleted: true;
      unlinkedProducts: { documentId: string; name: string }[];
      productsWithoutCategory: { documentId: string; name: string }[];
    }> {
      const before = await findOr404(documentId);
      const rows = await allRows();
      const children = rows.filter((row) => row.parent?.documentId === documentId);
      if (children.length > 0) {
        throw new OrderingError(
          'CATEGORY_HAS_CHILDREN',
          'delete or move child categories first',
          {
            details: {
              documentId,
              children: children.map((row) => row.documentId),
            },
          },
        );
      }
      const linked = await linkedProducts(before.id);
      const nameOf = (product: { name: Record<string, string> }) =>
        pickName(product.name, 'vi');
      if (linked.length > 0 && input.confirm !== true) {
        throw new OrderingError(
          'CATEGORY_HAS_PRODUCTS',
          `${linked.length} product(s) still belong to this category; confirm to unlink them`,
          {
            details: {
              documentId,
              productCount: linked.length,
              products: linked.map((product) => ({
                documentId: product.documentId,
                name: nameOf(product),
              })),
            },
          },
        );
      }

      const result = await strapi.db.transaction(async () => {
        // Products whose only category is this one end up uncategorized — count each
        // linked product's *other* category links in one grouped query.
        const otherLinks = (await strapi.db
          .connection(CATEGORY_PRODUCT_LINK)
          .select('catalog_product_id')
          .count('* as cnt')
          .whereIn('catalog_product_id', linked.map((product) => product.id))
          .whereNot('catalog_category_id', before.id)
          .groupBy('catalog_product_id')) as { catalog_product_id: number; cnt: string | number }[];
        const remaining = new Map(
          otherLinks.map((row) => [row.catalog_product_id, Number(row.cnt)]),
        );
        await withAuditSuppressed(CATEGORY, () => strapi.documents(CATEGORY).delete({ documentId }));
        return {
          unlinked: linked.map((product) => ({
            documentId: product.documentId,
            name: nameOf(product),
          })),
          orphans: linked
            .filter((product) => (remaining.get(product.id) ?? 0) === 0)
            .map((product) => ({ documentId: product.documentId, name: nameOf(product) })),
        };
      });
      await changeLog().record(
        {
          action: 'catalog-category.delete',
          entityType: 'catalog-category',
          entityId: documentId,
          before: {
            name: pickName(before.name, 'vi'),
            productCount: linked.length,
          },
        },
        ctx,
      );
      return {
        deleted: true,
        unlinkedProducts: result.unlinked,
        productsWithoutCategory: result.orphans,
      };
    },

    /** ServiceContext for an admin request — staff actor scoped like every other service. */
    async contextFor(adminUser: { id?: number; roles?: { code?: string }[] }) {
      const actor = await scope().actorFromAdminUser(adminUser);
      return { actor } satisfies ServiceContext;
    },
  };
};

export default catalogCategory;
