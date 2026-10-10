import { collection } from '../internal';

export default collection(
  'outbox',
  {
    type: { type: 'string', required: true },
    aggregateType: { type: 'string', required: true },
    aggregateId: { type: 'string', required: true },
    payload: { type: 'json', required: true },
    uniqueKey: { type: 'string', required: true, unique: true },
    occurredAt: { type: 'datetime', required: true },
    availableAt: { type: 'datetime', required: true },
    attempts: { type: 'integer', required: true, default: 0 },
    lockedBy: { type: 'string' },
    lockedAt: { type: 'datetime' },
    leaseUntil: { type: 'datetime' },
    deliveredAt: { type: 'datetime' },
    failedAt: { type: 'datetime' },
    lastError: { type: 'text' },
  },
  { displayName: 'Outbox' },
);
