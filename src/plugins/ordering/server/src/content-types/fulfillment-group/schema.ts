import { collection } from '../internal';

export default collection(
  'fulfillment-group',
  {
    order: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order',
      inversedBy: 'fulfillmentGroups',
    },
    workflowName: { type: 'string', required: true },
    workflowVersion: { type: 'string', required: true },
    receiveMethod: { type: 'json', required: true },
    status: { type: 'string', required: true },
    fulfillmentAmount: { type: 'biginteger', required: true, default: 0 },
    lines: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.order-line',
      mappedBy: 'fulfillmentGroup',
    },
    fulfillments: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.fulfillment',
      mappedBy: 'group',
    },
  },
  { displayName: 'Nhóm giao nhận' },
);
