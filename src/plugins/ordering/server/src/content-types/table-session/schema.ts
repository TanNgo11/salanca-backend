import { collection } from '../internal';

export default collection(
  'table-session',
  {
    table: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.dining-table',
      inversedBy: 'sessions',
    },
    locationRef: { type: 'string', required: true },
    /** `open` while guests can still order; `closed` after staff collected and pressed close. */
    status: { type: 'string', required: true, default: 'open' },
    openedAt: { type: 'datetime', required: true },
    closedAt: { type: 'datetime' },
    /** actorRef of the staff member who ran "Thanh toán & đóng bàn". */
    closedBy: { type: 'string' },
    businessDate: { type: 'string', required: true },
    orders: {
      type: 'relation',
      relation: 'oneToMany',
      target: 'plugin::ordering.order',
      mappedBy: 'tableSession',
    },
  },
  { displayName: 'Phiên bàn' },
);
