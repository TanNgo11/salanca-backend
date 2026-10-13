import { collection } from '../internal';

/**
 * Portions already reserved for one entity at one branch on one business date.
 * `reserved` never exceeds the matching daily limit; migration 0005 holds the
 * unique key and `CHECK (reserved >= 0)`. The counter moves only inside
 * `daily-stock`, by a conditional upsert.
 */
export default collection(
  'catalog-daily-usage',
  {
    entityType: {
      type: 'enumeration',
      enum: ['product', 'variant', 'modifier'],
      required: true,
    },
    entityDocumentId: { type: 'string', required: true },
    locationRef: { type: 'string', required: true },
    businessDate: { type: 'date', required: true },
    reserved: { type: 'integer', required: true, default: 0, min: 0 },
  },
  { displayName: 'Suất đã giữ trong ngày' },
);
