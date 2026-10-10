import { collection } from '../internal';

export default collection(
  'order-event',
  {
    order: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order',
      inversedBy: 'timeline',
    },
    type: { type: 'string', required: true },
    actorRef: { type: 'string' },
    isPublic: { type: 'boolean', required: true, default: false },
    payload: { type: 'json' },
    occurredAt: { type: 'datetime', required: true },
  },
  { displayName: 'Dòng thời gian đơn' },
);
