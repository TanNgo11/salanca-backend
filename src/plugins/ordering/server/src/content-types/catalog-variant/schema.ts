import { catalogCollection } from '../internal';

/**
 * Sellable SKU identity (contracts §20.1). SKU uniqueness lives in migration 0002 — Strapi
 * `unique: true` is application-level only and creates no database index. A product without
 * real variants keeps one default variant (`isDefault`).
 */
export default catalogCollection(
  'catalog-variant',
  {
    product: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.catalog-product',
      inversedBy: 'variants',
      required: true,
    },
    sku: { type: 'string' },
    name: {
      type: 'customField',
      customField: 'plugin::ordering.localized-text',
      required: true,
    },
    attributes: { type: 'json' },
    isDefault: { type: 'boolean', default: false },
    rank: { type: 'integer', default: 0 },
    trackInventory: { type: 'boolean', default: false },
    inventoryRef: { type: 'string' },
    prices: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.catalog-price',
      mappedBy: 'variant',
    },
  },
  { displayName: 'Biến thể' },
);
