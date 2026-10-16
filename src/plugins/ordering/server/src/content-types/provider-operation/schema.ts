import { collection } from '../internal';

/**
 * Durable boundary record for provider calls that can create an external side effect. The row
 * is committed before HTTP starts, so a DB failure after provider success cannot make a retry
 * look like a brand-new operation. Request details deliberately exclude addresses, phones and
 * staff notes.
 */
export default collection(
  'provider-operation',
  {
    operationKey: { type: 'string', required: true },
    kind: {
      type: 'enumeration',
      enum: ['carrier-book', 'carrier-cancel'],
      required: true,
    },
    state: {
      type: 'enumeration',
      enum: ['prepared', 'dispatching', 'succeeded', 'rejected', 'unknown', 'resolved'],
      required: true,
      default: 'prepared',
    },
    providerCode: { type: 'string', required: true },
    orderId: { type: 'integer', required: true },
    fulfillmentId: { type: 'integer', required: true },
    codAmount: { type: 'biginteger' },
    serviceId: { type: 'string' },
    providerReference: { type: 'string' },
    attempts: { type: 'integer', required: true, default: 0 },
    lastErrorCode: { type: 'string' },
    startedAt: { type: 'datetime' },
    finishedAt: { type: 'datetime' },
  },
  { displayName: 'Provider operation' },
);
