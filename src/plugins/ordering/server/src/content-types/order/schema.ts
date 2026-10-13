import { collection } from '../internal';

const oneToMany = (target: string, mappedBy: string) => ({
  type: 'relation',
  relation: 'oneToMany',
  target: `plugin::ordering.${target}`,
  mappedBy,
});

export default collection(
  'order',
  {
    code: { type: 'string', required: true, unique: true },
    publicTokenHash: { type: 'string', required: true, unique: true },
    status: {
      type: 'enumeration',
      enum: ['draft', 'open', 'completed', 'canceled'],
      required: true,
      default: 'open',
    },
    paymentStatus: {
      type: 'enumeration',
      enum: ['unpaid', 'partially-paid', 'paid', 'overpaid', 'partially-refunded', 'refunded'],
      required: true,
      default: 'unpaid',
    },
    fulfillmentStatus: {
      type: 'enumeration',
      enum: ['not-started', 'in-progress', 'partially-done', 'done', 'canceled'],
      required: true,
      default: 'not-started',
    },
    subtotalAmount: { type: 'biginteger', required: true },
    adjustmentAmount: { type: 'biginteger', required: true },
    fulfillmentAmount: { type: 'biginteger', required: true },
    taxAmount: { type: 'biginteger', required: true },
    totalAmount: { type: 'biginteger', required: true },
    currency: { type: 'string', required: true, default: 'VND' },
    customerRef: { type: 'string' },
    // O11: owning side of order.customer — a linked profile when the order's phone matches one
    // (or the session's customer). Guest orders without a match keep null.
    customer: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.customer',
      inversedBy: 'orders',
    },
    contactSnapshot: { type: 'json', required: true },
    consentSnapshot: { type: 'json', required: true },
    customerNote: { type: 'text' },
    // Locale at placement: customer emails and the public order view use it. Not named `locale`
    // (Strapi reserves it for i18n).
    placedLocale: { type: 'string' },
    branch: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.branch',
      inversedBy: 'orders',
    },
    locationRef: { type: 'string', required: true },
    branchSnapshot: { type: 'json' },
    businessDate: { type: 'date', required: true },
    placedAt: { type: 'datetime', required: true },
    receiveMethod: { type: 'json', required: true },
    origin: { type: 'json', required: true },
    cartHash: { type: 'string' },
    draftConfirmedAt: { type: 'datetime' },
    /** Incremented on every staff edit. The client sends the revision it displayed. */
    editRevision: { type: 'integer', required: true, default: 0 },
    lines: oneToMany('order-line', 'order'),
    fulfillmentGroups: oneToMany('fulfillment-group', 'order'),
    fulfillments: oneToMany('fulfillment', 'order'),
    adjustments: oneToMany('order-adjustment', 'order'),
    payments: oneToMany('payment', 'order'),
    refunds: oneToMany('refund', 'order'),
    timeline: oneToMany('order-event', 'order'),
    holds: oneToMany('hold', 'order'),
    dailyReservations: oneToMany('catalog-daily-reservation', 'order'),
  },
  { displayName: 'Đơn hàng' },
);
