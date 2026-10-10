import { collection } from '../internal';

export default collection(
  'refund',
  {
    payment: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.payment',
      inversedBy: 'refunds',
    },
    order: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order',
      inversedBy: 'refunds',
    },
    amount: { type: 'biginteger', required: true },
    currency: { type: 'string', required: true },
    reason: { type: 'text', required: true },
    actorRef: { type: 'string' },
    idempotencyKey: { type: 'string' },
    providerReference: { type: 'string' },
    status: {
      type: 'enumeration',
      enum: ['pending', 'settled', 'failed'],
      required: true,
      default: 'pending',
    },
    settledAt: { type: 'datetime' },
    lines: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.refund-line',
      mappedBy: 'refund',
    },
  },
  { displayName: 'Hoàn tiền' },
);
