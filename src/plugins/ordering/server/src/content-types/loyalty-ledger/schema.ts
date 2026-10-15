import { collection } from '../internal';

/**
 * The append-only loyalty ledger (O16). One row per lot touched; `points` is signed,
 * `balanceAfter` the customer's balance after the row, so `pointsBalance = Σ points`. `baseAmount`
 * (signed merchandise VND) feeds the 12-month spend that decides the tier and is null for rows that
 * do not move it. No route or service updates or deletes a row. Ids are plain integer columns so
 * migration 0013 can put unique/partial indexes on them.
 */
export default collection(
  'loyalty-ledger',
  {
    customerId: { type: 'integer', required: true },
    kind: {
      type: 'enumeration',
      enum: ['earn', 'redeem', 'release', 'reverse', 'expire', 'adjust', 'history', 'forfeit'],
      required: true,
    },
    points: { type: 'integer', required: true, default: 0 },
    baseAmount: { type: 'biginteger' },
    balanceAfter: { type: 'integer', required: true },
    orderId: { type: 'integer' },
    lotId: { type: 'integer' },
    actorRef: { type: 'string' },
    reason: { type: 'text' },
    at: { type: 'datetime', required: true },
  },
  { displayName: 'Sổ điểm' },
);
