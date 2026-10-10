import { collection } from '../internal';

export default collection(
  'fulfillment',
  {
    order: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order',
      inversedBy: 'fulfillments',
    },
    group: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.fulfillment-group',
      inversedBy: 'fulfillments',
    },
    providerCode: { type: 'string', required: true },
    providerReference: { type: 'string' },
    status: { type: 'string', required: true },
    assigneeRef: { type: 'string' },
    addressSnapshot: { type: 'json' },
    packedAt: { type: 'datetime' },
    shippedAt: { type: 'datetime' },
    deliveredAt: { type: 'datetime' },
    canceledAt: { type: 'datetime' },
    trackingNumber: { type: 'string' },
    trackingUrl: { type: 'string' },
    metadata: { type: 'json' },
    lines: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.fulfillment-line',
      mappedBy: 'fulfillment',
    },
  },
  { displayName: 'Đợt giao nhận' },
);
