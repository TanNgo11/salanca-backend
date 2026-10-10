import { collection } from '../internal';

export default collection(
  'order-adjustment',
  {
    order: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order',
      inversedBy: 'adjustments',
    },
    kind: { type: 'enumeration', enum: ['discount', 'fee', 'rounding'], required: true },
    code: { type: 'string', required: true },
    label: { type: 'string', required: true },
    sourceRef: { type: 'string' },
    ruleSnapshot: { type: 'json' },
    amount: { type: 'biginteger', required: true },
    taxable: { type: 'boolean', default: true },
    priority: { type: 'integer', default: 0 },
    allocations: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.adjustment-allocation',
      mappedBy: 'adjustment',
    },
  },
  { displayName: 'Điều chỉnh đơn' },
);
