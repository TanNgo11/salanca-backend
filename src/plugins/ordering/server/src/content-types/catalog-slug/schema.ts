import { collection } from '../internal';

/**
 * Per-locale slug index for category/product (contracts §20.1, plan decision): one row per
 * (entity, locale) maintained by the catalog-slug service inside Document Service middleware.
 * Unique (entityType, locale, slug) lives in migration 0002. Hidden — never edited by hand.
 */
export default collection(
  'catalog-slug',
  {
    entityType: {
      type: 'enumeration',
      enum: ['catalog-category', 'catalog-product'],
      required: true,
    },
    entityDocumentId: { type: 'string', required: true },
    locale: { type: 'string', required: true },
    slug: { type: 'string', required: true },
  },
  { displayName: 'Slug catalog' },
);
