import { collection } from '../internal';

/**
 * One row per (endpoint, outbox event) — the unit the dispatcher claims, signs and posts.
 * `payload` is the exact body sent (PII already filtered, customer block only when the endpoint
 * opted in). `lastError` is a ≤300-char safe summary — never a response body or a URL with a
 * query string. The unique index on (endpoint_id, event_id) lives in migration 0006.
 */
export default collection(
  'webhook-delivery',
  {
    endpointId: { type: 'integer', required: true },
    /** Outbox event id, or `ping:<uuid>` for a manual test send. */
    eventId: { type: 'string', required: true },
    eventType: { type: 'string', required: true },
    payload: { type: 'json', required: true },
    status: {
      type: 'enumeration',
      enum: ['pending', 'succeeded', 'failed'],
      required: true,
      default: 'pending',
    },
    attempts: { type: 'integer', required: true, default: 0 },
    nextAttemptAt: { type: 'datetime' },
    lastStatusCode: { type: 'integer' },
    lastError: { type: 'text' },
    lastDurationMs: { type: 'integer' },
    leaseUntil: { type: 'datetime' },
    lockedBy: { type: 'string' },
    succeededAt: { type: 'datetime' },
  },
  { displayName: 'Nhật ký gửi webhook' },
);
