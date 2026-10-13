import { collection } from '../internal';

/**
 * Customer profile (O11, plan step 1). Identity is the E.164 phone — unique while present, set
 * to null on erasure; `phoneHash` is the irreversible lookup key kept even after erasure so the
 * same person can be recognized without retaining the number. Stats (orderCount/totalSpent/
 * lastOrderAt) describe completed orders and are refreshed by the order.transitioned consumer.
 */
export default collection(
  'customer',
  {
    phone: { type: 'string' },
    phoneHash: { type: 'string' },
    email: { type: 'string' },
    emailVerifiedAt: { type: 'datetime' },
    name: { type: 'string' },
    status: {
      type: 'enumeration',
      enum: ['active', 'unverified', 'erased'],
      required: true,
      default: 'unverified',
    },
    marketingConsent: { type: 'json' },
    orderCount: { type: 'integer', required: true, default: 0 },
    totalSpent: { type: 'biginteger', required: true, default: '0' },
    lastOrderAt: { type: 'datetime' },
    erasedAt: { type: 'datetime' },
    staffNote: { type: 'text' },
    orders: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.order',
      mappedBy: 'customer',
    },
    addresses: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.customer-address',
      mappedBy: 'customer',
    },
    sessions: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.customer-session',
      mappedBy: 'customer',
    },
    carts: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.cart',
      mappedBy: 'customer',
    },
    dataRequests: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.data-request',
      mappedBy: 'customer',
    },
  },
  { displayName: 'Khách hàng' },
);
