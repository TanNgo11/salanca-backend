import { collection } from '../internal';

/**
 * Personal-data request ledger (O11, Decree 13/2023). `customer` may be null for staff-created
 * requests whose phone matches no profile; `phoneHash` keeps the request searchable without
 * storing the number. `status`: received → waiting (orders still open) → done | rejected.
 * `result` records counts only (orders anonymized, rows deleted) — never personal data.
 */
export default collection(
  'data-request',
  {
    customer: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.customer',
      inversedBy: 'dataRequests',
    },
    phoneHash: { type: 'string', required: true },
    kind: {
      type: 'enumeration',
      enum: ['export', 'erase'],
      required: true,
    },
    source: {
      type: 'enumeration',
      enum: ['customer', 'staff'],
      required: true,
    },
    status: {
      type: 'enumeration',
      enum: ['received', 'waiting', 'done', 'rejected'],
      required: true,
      default: 'received',
    },
    requestedAt: { type: 'datetime', required: true },
    doneAt: { type: 'datetime' },
    handledBy: { type: 'string' },
    note: { type: 'text' },
    result: { type: 'json' },
  },
  { displayName: 'Yêu cầu dữ liệu cá nhân' },
);
