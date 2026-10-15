import { collection } from '../internal';

/**
 * One batch of points with its own expiry (O16). Ids are plain integer columns, not relations:
 * Strapi keeps relations in link tables, which cannot carry the unique/CHECK/partial indexes
 * migration 0013 puts on this table (same reasoning as `customer-group-member`).
 * Invariant: `0 ≤ remaining ≤ points`; Σ remaining of a customer = max(0, `pointsBalance`).
 */
export default collection(
  'loyalty-lot',
  {
    customerId: { type: 'integer', required: true },
    orderId: { type: 'integer' },
    source: { type: 'enumeration', enum: ['earn', 'restore', 'adjust'], required: true },
    points: { type: 'integer', required: true },
    remaining: { type: 'integer', required: true },
    expiresAt: { type: 'datetime', required: true },
    reminderSentAt: { type: 'datetime' },
  },
  { displayName: 'Lô điểm' },
);
