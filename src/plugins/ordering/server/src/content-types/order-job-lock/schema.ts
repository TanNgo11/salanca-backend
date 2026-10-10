import { collection } from '../internal';

export default collection(
  'order-job-lock',
  {
    jobName: { type: 'string', required: true },
    shardKey: { type: 'string', required: true, default: 'default' },
    owner: { type: 'string' },
    lockedAt: { type: 'datetime' },
    expiresAt: { type: 'datetime' },
    attempts: { type: 'integer', required: true, default: 0 },
    lastError: { type: 'text' },
    lastSuccessAt: { type: 'datetime' },
  },
  { displayName: 'Khóa job đơn hàng' },
);
