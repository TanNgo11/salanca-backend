import { collection } from '../internal';

export default collection(
  'fulfillment-line',
  {
    fulfillment: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.fulfillment',
      inversedBy: 'lines',
    },
    line: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order-line',
    },
    quantity: { type: 'integer', required: true },
  },
  { displayName: 'Dòng giao nhận' },
);
