import { collection } from '../internal';

/**
 * Customer login session (O11). The bearer token is 32 random bytes sent in `X-Customer-Token`;
 * the row keeps only its SHA-256 (`tokenHash`, unique index in migration 0007). Expiry slides
 * 30 days on use; `revokedAt` marks logout/erasure. At most 10 live sessions per customer —
 * creating the 11th revokes the oldest.
 */
export default collection(
  'customer-session',
  {
    customer: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.customer',
      inversedBy: 'sessions',
    },
    tokenHash: { type: 'string', required: true },
    lastSeenAt: { type: 'datetime', required: true },
    expiresAt: { type: 'datetime', required: true },
    userAgent: { type: 'string' },
    revokedAt: { type: 'datetime' },
  },
  { displayName: 'Phiên đăng nhập khách' },
);
