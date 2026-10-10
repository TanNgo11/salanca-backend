import { collection } from '../internal';

export default collection(
  'refund-line',
  {
    refund: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.refund',
      inversedBy: 'lines',
    },
    line: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order-line',
      inversedBy: 'refundLines',
    },
    quantity: { type: 'integer', required: true },
    amount: { type: 'biginteger', required: true },
  },
  { displayName: 'Dòng hoàn tiền' },
);
