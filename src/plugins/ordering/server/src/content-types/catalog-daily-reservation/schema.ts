import { collection } from '../internal';

/**
 * Ledger row tying reserved portions back to an order line so cancel and edit
 * can return the same quantity. `order` / `line` are relations (link tables),
 * same as hold. Migration 0005 checks `released_quantity <= quantity`.
 */
export default collection(
  'catalog-daily-reservation',
  {
    order: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order',
      inversedBy: 'dailyReservations',
      required: true,
    },
    line: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order-line',
      inversedBy: 'dailyReservations',
      required: true,
    },
    entityType: {
      type: 'enumeration',
      enum: ['product', 'variant', 'modifier'],
      required: true,
    },
    entityDocumentId: { type: 'string', required: true },
    locationRef: { type: 'string', required: true },
    businessDate: { type: 'date', required: true },
    quantity: { type: 'integer', required: true, min: 1 },
    releasedQuantity: { type: 'integer', required: true, default: 0, min: 0 },
  },
  { displayName: 'Giữ suất theo dòng' },
);
