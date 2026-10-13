import { collection } from '../internal';

/**
 * Server-side cart (O11, contracts §15). Guest carts are addressed by a bearer token sent in
 * `X-Cart-Token` (only `tokenHash` stored); customer carts ride the session. `lines` is a JSON
 * list of `{ id, sellableUid, variantUid?, selected, quantity, note? }` capped at 50 entries —
 * the cart is never the source of truth for prices: every read re-quotes on the server. Promo
 * codes and gift cards are deliberately absent (O8/O9). Expiry slides 7 days from last
 * activity; `reminderSentAt` marks the one abandoned-cart email.
 */
export default collection(
  'cart',
  {
    tokenHash: { type: 'string' },
    customer: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.customer',
      inversedBy: 'carts',
    },
    locationRef: { type: 'string' },
    receiveMethod: { type: 'json' },
    pickup: { type: 'json' },
    contact: { type: 'json' },
    lines: { type: 'json', required: true },
    status: {
      type: 'enumeration',
      enum: ['active', 'converted', 'expired'],
      required: true,
      default: 'active',
    },
    order: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::ordering.order',
    },
    locale: { type: 'string' },
    lastActivityAt: { type: 'datetime', required: true },
    expiresAt: { type: 'datetime', required: true },
    reminderSentAt: { type: 'datetime' },
  },
  { displayName: 'Giỏ hàng' },
);
