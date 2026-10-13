import { collection } from '../internal';

/**
 * The append-only gift-card ledger (O9 plan invariants). One row per balance change or
 * status action; `amount` is signed and zero for block/unblock/extend. No route or service
 * may update or delete a row — `balance` always equals Σ amount of the card's rows.
 */
export default collection(
  'gift-card-ledger',
  {
    card: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.gift-card',
      inversedBy: 'ledgerEntries',
    },
    kind: {
      type: 'enumeration',
      enum: ['issue', 'redeem', 'refund', 'adjust', 'expire', 'block', 'unblock', 'extend', 'activate'],
      required: true,
    },
    amount: { type: 'biginteger', required: true, default: 0 },
    balanceAfter: { type: 'biginteger', required: true },
    order: { type: 'relation', relation: 'manyToOne', target: 'plugin::ordering.order' },
    payment: { type: 'relation', relation: 'manyToOne', target: 'plugin::ordering.payment' },
    refund: { type: 'relation', relation: 'manyToOne', target: 'plugin::ordering.refund' },
    actorRef: { type: 'string' },
    reason: { type: 'text' },
    at: { type: 'datetime', required: true },
  },
  { displayName: 'Sổ thẻ quà tặng' },
);
