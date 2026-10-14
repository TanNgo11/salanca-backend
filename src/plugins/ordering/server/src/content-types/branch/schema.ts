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
    // O11: abandoned-cart reminder mails are opt-in per branch (marketing consent still rules).
    cartReminderEnabled: { type: 'boolean', default: false },
    rank: { type: 'integer', default: 0 },
    fulfillment: { type: 'json' },
    tax: { type: 'json' },
    cashRounding: { type: 'json' },
    // O12: per-receive-kind pause deadlines `{ pickup?, delivery?, dineIn? }` (until ISO instant).
    orderingPause: { type: 'json' },
    // O12: busy mode `{ extraMinutes, until, by }` — adds lead time to new ASAP orders.
    busyMode: { type: 'json' },
    // O12: branch service/packaging fees (resolved by `resolveBranchFees`).
    fees: { type: 'json' },
    // O12: print layout `{ width, header?, footer?, autoKitchenTicket }`.
    printing: { type: 'json' },
    orders: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.order',
      mappedBy: 'branch',
    },
  },
  { displayName: 'Chi nhánh' },
);
