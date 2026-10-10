import { catalogCollection } from '../internal';

/**
 * One row per priced condition (contracts §20.1): base price today, location/channel/customer
 * group rules later. Amounts are integer VND; `compareAtAmount` renders the struck-through price.
 */
export default catalogCollection(
  'catalog-price',
  {
    variant: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.catalog-variant',
      inversedBy: 'prices',
      required: true,
    },
    amount: { type: 'biginteger', required: true },
    compareAtAmount: { type: 'biginteger' },
    currency: { type: 'string', required: true, default: 'VND' },
    minQuantity: { type: 'integer', default: 1 },
    rules: { type: 'json' },
    priority: { type: 'integer', default: 0 },
    validFrom: { type: 'datetime' },
    validTo: { type: 'datetime' },
  },
  { displayName: 'Giá' },
);
