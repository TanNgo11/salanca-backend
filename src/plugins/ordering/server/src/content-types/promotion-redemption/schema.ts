import { collection } from '../internal';

/**
 * One use of a promotion on an order. `reserved` at create, `applied` when the order
 * completes, `released` when it is canceled. `customerKey` is an HMAC of the phone,
 * never the phone itself.
 */
export default collection(
  'promotion-redemption',
  {
    promotionId: { type: 'integer', required: true },
    promotionCodeId: { type: 'integer' },
    orderId: { type: 'integer', required: true },
    customerKey: { type: 'string', required: true },
    discountAmount: { type: 'integer', required: true },
    status: {
      type: 'enumeration',
      enum: ['reserved', 'applied', 'released'],
      required: true,
      default: 'reserved',
    },
    reservedAt: { type: 'datetime', required: true },
    appliedAt: { type: 'datetime' },
    releasedAt: { type: 'datetime' },
    releaseReason: { type: 'string' },
  },
  { displayName: 'Lượt dùng khuyến mãi' },
);
