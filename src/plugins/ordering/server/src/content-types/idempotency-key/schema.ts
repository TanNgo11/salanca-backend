import { collection } from '../internal';

export default collection(
  'idempotency-key',
  {
    scope: { type: 'string', required: true },
    key: { type: 'string', required: true },
    requestHash: { type: 'string', required: true },
    status: {
      type: 'enumeration',
      enum: ['in-progress', 'completed'],
      required: true,
      default: 'in-progress',
    },
    responseRef: { type: 'string' },
    responseSnapshot: { type: 'json' },
    expiresAt: { type: 'datetime', required: true },
  },
  { displayName: 'Khóa idempotency' },
);
