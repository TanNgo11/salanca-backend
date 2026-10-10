import { collection } from '../internal';

export default collection(
  'payment',
  {
    order: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order',
      inversedBy: 'payments',
    },
    providerCode: { type: 'string', required: true },
    requestedAmount: { type: 'biginteger', required: true, default: 0 },
    capturedAmount: { type: 'biginteger', required: true, default: 0 },
    refundedAmount: { type: 'biginteger', required: true, default: 0 },
    currency: { type: 'string', required: true },
    status: {
      type: 'enumeration',
      enum: ['pending', 'authorized', 'captured', 'failed', 'cancelled'],
      required: true,
      default: 'pending',
    },
    providerReference: { type: 'string' },
    actorRef: { type: 'string' },
    businessDate: { type: 'date' },
    capturedAt: { type: 'datetime' },
    events: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.payment-event',
      mappedBy: 'payment',
    },
    refunds: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.refund',
      mappedBy: 'payment',
    },
  },
  { displayName: 'Thanh toán' },
);
