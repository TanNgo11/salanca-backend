import type { Core } from '@strapi/strapi';

import { desiredSlugs } from '../domain/catalog/slug';
import { OrderingError } from '../domain/errors';

export type SlugEntityType = 'catalog-category' | 'catalog-product';

type SlugRow = {
  id: number;
  entityType: SlugEntityType;
  entityDocumentId: string;
  locale: string;
  slug: string;
};

const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';

/**
 * Maintains `catalog-slug` rows — one per (entity, locale) — for categories and products.
 * Called from the Document Service middleware inside the same transaction as the entity
 * write, so a slug conflict rolls the whole change back. Uniqueness per (entityType, locale)
 * is enforced by a partial unique index (migration 0002); the service pre-checks to return a
 * field-level error instead of a raw constraint failure.
 */
const catalogSlug = ({ strapi }: { strapi: Core.Strapi }) => {
  const slugs = () => strapi.db.query('plugin::ordering.catalog-slug');

  return {
    /**
     * Reconciles the entity's slug rows to the desired set derived from its (merged) name and
     * slug maps. Throws VALIDATION_ERROR when another entity already holds a slug in the same
     * locale; the same slug in a different locale is allowed.
     */
    async sync(input: {
      entityType: SlugEntityType;
      entityDocumentId: string;
      name?: unknown;
      slug?: unknown;
    }): Promise<void> {
      const { entityType, entityDocumentId } = input;
      const desired = desiredSlugs({ name: input.name, slug: input.slug });
      try {
        for (const [locale, slug] of desired) {
          const conflict = (await slugs().findOne({
            where: { entityType, locale, slug },
          })) as SlugRow | null;
          if (conflict && conflict.entityDocumentId !== entityDocumentId) {
            throw new OrderingError(
              'VALIDATION_ERROR',
              `slug "${slug}" is already used for locale "${locale}"`,
              { details: { field: `slug.${locale}`, locale, slug } },
            );
          }
        }
        const existing = (await slugs().findMany({
          where: { entityType, entityDocumentId },
        })) as SlugRow[];
        const byLocale = new Map(existing.map((row) => [row.locale, row]));
        for (const row of existing) {
          if (!desired.has(row.locale)) {
            await slugs().delete({ where: { id: row.id } });
          }
        }
        for (const [locale, slug] of desired) {
          const row = byLocale.get(locale);
          if (!row) {
            await slugs().create({
              data: { entityType, entityDocumentId, locale, slug },
            });
          } else if (row.slug !== slug) {
            await slugs().update({ where: { id: row.id }, data: { slug } });
          }
        }
      } catch (error) {
        // Concurrent writers can still race past the pre-check — the unique index is the
        // final guard, surface it as the same field-level error.
        if (isUniqueViolation(error)) {
          throw new OrderingError('VALIDATION_ERROR', 'slug is already used in this locale', {
            details: { field: 'slug' },
          });
        }
        throw error;
      }
    },

    /** Releases every slug row of a deleted entity. */
    async release(entityType: SlugEntityType, entityDocumentId: string): Promise<void> {
      await slugs().deleteMany({ where: { entityType, entityDocumentId } });
    },

    /** Resolves a public slug to an entity documentId — used by the storefront API. */
    async findDocumentId(
      entityType: SlugEntityType,
      locale: string,
      slug: string,
    ): Promise<string | null> {
      const row = (await slugs().findOne({
        where: { entityType, locale, slug },
      })) as SlugRow | null;
      return row?.entityDocumentId ?? null;
    },
  };
};

export default catalogSlug;
