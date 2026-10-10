import { collection } from '../internal';

export default collection(
  'ops-alert',
  {
    alertCode: { type: 'string', required: true },
    dedupeKey: { type: 'string', required: true },
    severity: {
      type: 'enumeration',
      enum: ['info', 'warning', 'critical'],
      required: true,
      default: 'warning',
    },
    aggregateRef: { type: 'string' },
    status: {
      type: 'enumeration',
      enum: ['open', 'acknowledged', 'resolved'],
      required: true,
      default: 'open',
    },
    acknowledgedBy: { type: 'string' },
    acknowledgedAt: { type: 'datetime' },
    resolvedAt: { type: 'datetime' },
    firstSeenAt: { type: 'datetime', required: true },
    lastSeenAt: { type: 'datetime', required: true },
    count: { type: 'integer', required: true, default: 1 },
  },
  { displayName: 'Cảnh báo vận hành' },
);
