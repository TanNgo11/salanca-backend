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
    // The ops screen needs the last run start/duration even when the run failed — a missing
    // last_success_at alone cannot tell "never ran" from "ran and failed".
    lastRunAt: { type: 'datetime' },
    lastDurationMs: { type: 'integer' },
  },
  { displayName: 'Khóa job đơn hàng' },
);
