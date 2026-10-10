import { collection } from '../internal';

export default collection(
  'adjustment-allocation',
  {
    adjustment: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order-adjustment',
      inversedBy: 'allocations',
    },
    line: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order-line',
      inversedBy: 'allocations',
    },
    weight: { type: 'biginteger', required: true },
    amount: { type: 'biginteger', required: true },
  },
  { displayName: 'Phân bổ điều chỉnh' },
);
