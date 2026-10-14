import { collection } from '../internal';

/**
 * One row per (outbox event, template, recipient) — the delivery log of contracts §14. The
 * recipient is stored only as a SHA-256 hash; the unique index (migration 0003) makes a re-run
 * of the dispatcher skip deliveries that were already sent.
 */
export default collection(
  'notification-delivery',
  {
    eventId: { type: 'string', required: true },
    template: { type: 'string', required: true },
    channel: { type: 'string', required: true },
    recipientHash: { type: 'string', required: true },
    recipientRole: { type: 'string' },
    orderId: { type: 'integer' },
    messageLocale: { type: 'string' },
    status: {
      type: 'enumeration',
      enum: ['pending', 'sent', 'failed', 'skipped'],
      required: true,
      default: 'pending',
    },
    attempts: { type: 'integer', required: true, default: 0 },
    lastError: { type: 'text' },
    sentAt: { type: 'datetime' },
    // O13: provider-side message id (Zalo msg_id / eSMS SMSID) and the configured cost
    // estimate of the channel actually used — both null for skipped/failed/email.
    providerMessageId: { type: 'string' },
    costEstimate: { type: 'integer' },
  },
  { displayName: 'Nhật ký gửi thông báo' },
);
