import { collection } from '../internal';

export default collection(
  'hold',
  {
    order: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order',
      inversedBy: 'holds',
    },
    line: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order-line',
    },
    group: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.fulfillment-group',
    },
    resourceRef: { type: 'string' },
    quantity: { type: 'integer', required: true, default: 1 },
    expiresAt: { type: 'datetime', required: true },
    releasedAt: { type: 'datetime' },
    releaseReason: { type: 'string' },
  },
  { displayName: 'Giữ chỗ' },
);
