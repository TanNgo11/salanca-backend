import { collection } from '../internal';

/**
 * A named set of price conditions (O14). `override` copies one catalog-price row per selected
 * variant (relation `catalog-price.priceList`); `adjust` stores no rows and is applied when a
 * price is chosen. `createdByRef` is not `createdBy` — Strapi reserves that name.
 */
export default collection(
  'price-list',
  {
    name: { type: 'json', required: true },
    kind: { type: 'enumeration', enum: ['override', 'adjust'], required: true },
    rules: { type: 'json' },
    adjust: { type: 'json' },
    /** Override lines the editor reloads. Child catalog-price rows are derived from this. */
    lines: { type: 'json' },
    priority: { type: 'integer', required: true, default: 0 },
    active: { type: 'boolean', required: true, default: true },
    validFrom: { type: 'datetime' },
    validTo: { type: 'datetime' },
    createdByRef: { type: 'string' },
  },
  { displayName: 'Bảng giá' },
);
