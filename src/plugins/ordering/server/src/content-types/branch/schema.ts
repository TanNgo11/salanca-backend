import { collection } from '../internal';

export default collection(
  'branch',
  {
    code: { type: 'string', required: true, unique: true },
    name: { type: 'customField', customField: 'plugin::ordering.localized-text', required: true },
    address: { type: 'json' },
    phone: { type: 'string' },
    email: { type: 'string' },
    timezone: { type: 'string', required: true, default: 'Asia/Ho_Chi_Minh' },
    isActive: { type: 'boolean', default: true },
    onlineOrdering: { type: 'boolean', default: false },
    rank: { type: 'integer', default: 0 },
    fulfillment: { type: 'json' },
    tax: { type: 'json' },
    cashRounding: { type: 'json' },
    orders: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.order',
      mappedBy: 'branch',
    },
  },
  { displayName: 'Chi nhánh' },
);
