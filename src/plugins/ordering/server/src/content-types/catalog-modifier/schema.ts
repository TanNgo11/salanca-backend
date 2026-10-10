import { catalogCollection } from '../internal';

/**
 * One add-on choice inside a group (contracts §20.1). `priceDelta` is the library default a
 * product can override per dish; it adds to the order line price and never creates a SKU.
 */
export default catalogCollection(
  'catalog-modifier',
  {
    group: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.catalog-modifier-group',
      inversedBy: 'modifiers',
      required: true,
    },
    name: {
      type: 'customField',
      customField: 'plugin::ordering.localized-text',
      required: true,
    },
    priceDelta: { type: 'biginteger', required: true, default: 0 },
    rank: { type: 'integer', default: 0 },
    trackInventory: { type: 'boolean', default: false },
    inventoryRef: { type: 'string' },
  },
  { displayName: 'Tùy chọn' },
);
