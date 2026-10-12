import { collection } from '../internal';

/**
 * End-of-day cash closing per (locationRef, businessDate, collectorRef) — contracts §19.3,
 * screens V3. One `current` row per triple (partial unique index in migration 0004); corrections
 * append a new revision and supersede the old row, never edit in place.
 */
export default collection(
  'cash-closing',
  {
    locationRef: { type: 'string', required: true },
    businessDate: { type: 'date', required: true },
    // `admin:<id>` of the staff member who collected (delivery legs attribute cash to the
    // courier); 'system' rows are for payments without an actor.
    collectorRef: { type: 'string', required: true },
    orderCount: { type: 'integer', required: true },
    systemAmount: { type: 'biginteger', required: true },
    refundAmount: { type: 'biginteger', required: true },
    expectedAmount: { type: 'biginteger', required: true },
    countedAmount: { type: 'biginteger', required: true },
    differenceAmount: { type: 'biginteger', required: true },
    note: { type: 'text' },
    closedBy: { type: 'string', required: true },
    closedAt: { type: 'datetime', required: true },
    status: {
      type: 'enumeration',
      enum: ['current', 'superseded'],
      required: true,
      default: 'current',
    },
    revision: { type: 'integer', required: true, default: 1 },
    supersedesId: { type: 'integer' },
    adjustmentReason: { type: 'text' },
  },
  { displayName: 'Chốt tiền mặt' },
);
