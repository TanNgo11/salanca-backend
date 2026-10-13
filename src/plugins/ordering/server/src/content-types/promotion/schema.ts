import { collection } from '../internal';

/**
 * A discount campaign. Money columns are integers (VND). `usedCount` moves only inside
 * `services/promotion` under a row lock; migration 0008 checks it stays non-negative.
 * `createdByRef` is not `createdBy` — Strapi reserves that name for the admin user link.
 */
export default collection(
  'promotion',
  {
    name: { type: 'json', required: true },
    internalNote: { type: 'text' },
    kind: { type: 'enumeration', enum: ['code', 'auto'], required: true },
    discountType: {
      type: 'enumeration',
      enum: ['percent', 'amount', 'free-delivery', 'delivery-amount'],
      required: true,
    },
    value: { type: 'integer' },
    maxDiscount: { type: 'integer' },
    target: { type: 'json', required: true },
    minSubtotal: { type: 'integer', required: true, default: 0 },
    locationRefs: { type: 'json' },
    receiveKinds: { type: 'json', required: true },
    startsAt: { type: 'datetime', required: true },
    endsAt: { type: 'datetime' },
    weekdays: { type: 'json', required: true },
    timeRanges: { type: 'json', required: true },
    firstOrderOnly: { type: 'boolean', required: true, default: false },
    usageLimit: { type: 'integer' },
    perCustomerLimit: { type: 'integer' },
    stackable: { type: 'boolean', required: true, default: false },
    priority: { type: 'integer', required: true, default: 0 },
    active: { type: 'boolean', required: true, default: true },
    usedCount: { type: 'integer', required: true, default: 0 },
    createdByRef: { type: 'string' },
  },
  { displayName: 'Khuyến mãi' },
);
