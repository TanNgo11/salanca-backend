import { catalogCollection } from '../internal';

/**
 * Sellable product (contracts §20.1). `status` replaces Draft & Publish; only `active` +
 * `sellOnline` products reach the public catalog API. `modifierGroups`/`bundleSlots` stay
 * plain `json` here — Step 4 swaps them to structured custom fields (same jsonb column).
 */
export default catalogCollection(
  'catalog-product',
  {
    productType: { type: 'string', required: true, default: 'food' },
    name: {
      type: 'customField',
      customField: 'plugin::ordering.localized-text',
      required: true,
    },
    description: { type: 'customField', customField: 'plugin::ordering.localized-text' },
    slug: { type: 'customField', customField: 'plugin::ordering.localized-text' },
    image: { type: 'media', multiple: false, required: false, allowedTypes: ['images'] },
    categories: {
      type: 'relation',
      relation: 'manyToMany',
      target: 'plugin::ordering.catalog-category',
      inversedBy: 'products',
    },
    status: {
      type: 'enumeration',
      enum: ['draft', 'active', 'archived'],
      required: true,
      default: 'draft',
    },
    sellOnline: { type: 'boolean', default: false },
    minQuantity: { type: 'integer', default: 1 },
    fulfillmentKinds: { type: 'json' },
    taxGroupRef: { type: 'string' },
    modifierGroups: { type: 'json' },
    bundleSlots: { type: 'json' },
    rank: { type: 'integer', default: 0 },
    metadata: { type: 'json' },
    variants: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.catalog-variant',
      mappedBy: 'product',
    },
    availabilityWindows: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.catalog-availability-window',
      mappedBy: 'product',
    },
  },
  { displayName: 'Sản phẩm bán online' },
);
