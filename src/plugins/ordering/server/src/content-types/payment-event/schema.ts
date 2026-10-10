import { collection } from '../internal';

export default collection(
  'payment-event',
  {
    payment: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.payment',
      inversedBy: 'events',
    },
    providerCode: { type: 'string', required: true },
    providerTransactionId: { type: 'string', required: true },
    transferType: { type: 'enumeration', enum: ['in', 'out'] },
    amount: { type: 'biginteger', required: true },
    currency: { type: 'string', required: true },
    kind: { type: 'string', required: true },
    rawPayload: { type: 'json' },
    receivedAt: { type: 'datetime', required: true },
    reviewStatus: {
      type: 'enumeration',
      enum: ['auto-matched', 'needs-review', 'matched-manually', 'refund-due', 'ignored'],
      required: true,
      default: 'auto-matched',
    },
    reviewReason: { type: 'string' },
    reviewedBy: { type: 'string' },
    reviewedAt: { type: 'datetime' },
  },
  { displayName: 'Sự kiện thanh toán' },
);
