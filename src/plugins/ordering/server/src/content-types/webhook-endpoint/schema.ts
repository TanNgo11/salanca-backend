import { collection } from '../internal';

/**
 * A subscriber URL for signed outbound events (O10). `secretSealed`/`previousSecretSealed` hold
 * AES-256-GCM ciphertexts of the signing secret — the plaintext is returned once at
 * create/rotate and never stored. `endpointId` on `webhook-delivery` is a plain column (like
 * `notification-delivery.orderId`) so the (endpoint, event) unique index can live on the table.
 */
export default collection(
  'webhook-endpoint',
  {
    url: { type: 'string', required: true },
    description: { type: 'string' },
    /** Subscribed public event types (`domain/webhooks/events.ts`). */
    events: { type: 'json', required: true },
    active: { type: 'boolean', required: true, default: true },
    /** Opt-in: payloads may carry customer name/phone/email/address. */
    includeCustomer: { type: 'boolean', required: true, default: false },
    secretSealed: { type: 'string', required: true },
    previousSecretSealed: { type: 'string' },
    previousSecretUntil: { type: 'datetime' },
    consecutiveFailures: { type: 'integer', required: true, default: 0 },
    disabledAt: { type: 'datetime' },
    /** 'manual' or 'auto-failures' — the UI shows the badge from this. */
    disabledReason: { type: 'string' },
    /** Actor ref (`admin:<id>`/`system`) — `createdBy` is reserved for Strapi's admin link. */
    createdByRef: { type: 'string' },
  },
  { displayName: 'Webhook endpoint' },
);
