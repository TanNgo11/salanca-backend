import { catalogCollection } from '../internal';

/**
 * Category tree (contracts §20.1). `isInternal` categories are hidden from the public catalog
 * API (e.g. a "Món test" bucket); `isActive` controls whether products in it sell at all.
 */
export default catalogCollection(
  'catalog-category',
  {
    name: {
      type: 'customField',
      customField: 'plugin::ordering.localized-text',
      required: true,
    },
    description: { type: 'customField', customField: 'plugin::ordering.localized-text' },
    slug: { type: 'customField', customField: 'plugin::ordering.localized-text' },
    parent: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.catalog-category',
      inversedBy: 'children',
    },
    children: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.catalog-category',
      mappedBy: 'parent',
    },
    image: { type: 'media', multiple: false, required: false, allowedTypes: ['images'] },
    rank: { type: 'integer', default: 0 },
    isActive: { type: 'boolean', default: true },
    isInternal: { type: 'boolean', default: false },
    products: {
      type: 'relation',
      relation: 'manyToMany',
      target: 'plugin::ordering.catalog-product',
      mappedBy: 'categories',
    },
    availabilityWindows: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.catalog-availability-window',
      mappedBy: 'category',
    },
  },
  { displayName: 'Danh mục bán hàng' },
);
