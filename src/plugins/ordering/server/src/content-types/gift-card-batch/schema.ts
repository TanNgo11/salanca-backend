import { collection } from '../internal';

/**
 * A physical preprinted-card batch (O9 decisions 2026-10-13): codes imported from CSV or
 * generated for printing. Its cards start `inactive` and only activate when sold at the
 * counter (source `batch` on the card).
 */
export default collection(
  'gift-card-batch',
  {
    code: { type: 'string', required: true },
    source: {
      type: 'enumeration',
      enum: ['imported', 'generated'],
      required: true,
    },
    denominationAmount: { type: 'biginteger', required: true },
    currency: { type: 'string', required: true, default: 'VND' },
    quantity: { type: 'integer', required: true },
    note: { type: 'text' },
    createdBy: { type: 'string' },
    cards: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.gift-card',
      mappedBy: 'batch',
    },
  },
  { displayName: 'Lô thẻ giấy' },
);
